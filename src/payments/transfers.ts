import { db } from "../db/client.ts";
import { env } from "../lib/env.ts";
import { randomUUID } from "../lib/crypto.ts";
import { chainIdOf } from "./allowlist.ts";
import { createJsonRpc, evmChainId, getReceipt, type JsonRpc } from "./chain.ts";
import { planSweeps, type SweepPlan } from "./evm-sweep.ts";
import { confirmAddressSweep, ensureAddressSweepTable } from "./address-sweeps.ts";

export class TransferError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export type TransferRow = {
  id: string;
  invoice_id: string;
  chain: string;
  status: string;
  to_address: string;
  base_units: string;
  tx_hash: string | null;
};

const ensureTable = () => {
  db.exec(`CREATE TABLE IF NOT EXISTS payment_transfers (
    id TEXT PRIMARY KEY,
    invoice_id TEXT NOT NULL,
    chain TEXT NOT NULL,
    status TEXT NOT NULL,
    to_address TEXT NOT NULL,
    base_units TEXT NOT NULL,
    unsigned_tx TEXT,
    tx_hash TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
};

const coldAddress = (chain: "polygon" | "ethereum") => (chain === "polygon" ? env.polygonColdAddress : env.ethereumColdAddress);

const rpcFor = (chain: "polygon" | "ethereum") => {
  const url = (chain === "polygon" ? env.polygonRpcUrls : env.ethereumRpcUrls)[0];
  if (!url) throw new TransferError("evm_payout_disabled", `${chain} RPC is not configured`);
  return createJsonRpc(url);
};

export const prepareTransferGas = async (chain: "polygon" | "ethereum", now = Date.now()) => {
  ensureTable();
  if (!/^0x[0-9a-fA-F]{40}$/.test(coldAddress(chain))) throw new TransferError("evm_payout_disabled", `Configure one ${chain} cold address`);
  const plans = await planSweeps(chain, now);
  const ready: TransferRow[] = [];
  for (const plan of plans) {
    const gas = await nativeBalance(rpcFor(chain), plan.fromAddress);
    if (gas <= 0n) throw new TransferError("gas_insufficient", "The paid address needs a small native gas balance");
    const id = randomUUID();
    db.prepare(
      "INSERT INTO payment_transfers (id, invoice_id, chain, status, to_address, base_units, unsigned_tx, created_at, updated_at) VALUES (?, ?, ?, 'gassed', ?, ?, ?, ?, ?)",
    ).run(id, plan.invoiceId, chain, plan.toAddress, plan.baseUnits, plan.unsignedTx, now, now);
    ready.push({ id, invoice_id: plan.invoiceId, chain, status: "gassed", to_address: plan.toAddress, base_units: plan.baseUnits, tx_hash: null });
  }
  return ready;
};

const nativeBalance = async (rpc: JsonRpc, address: string) => {
  const value = await rpc("eth_getBalance", [address, "latest"]);
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) throw new TransferError("confirmation_pending", "Native balance unavailable");
  return BigInt(value);
};

const signerRequest = async (plan: SweepPlan) => {
  let origin = "";
  try {
    origin = new URL(env.sweepSignerUrl).origin;
  } catch {
    origin = "";
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) throw new TransferError("evm_payout_disabled", "Sweep signer must be an explicit localhost URL");
  const response = await fetch(new URL("/sign", env.sweepSignerUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ unsignedTx: plan.unsignedTx, fromAddress: plan.fromAddress, derivationIndex: plan.derivationIndex, chainId: plan.chainId }),
  });
  if (!response.ok) throw new TransferError("evm_payout_disabled", `Sweep signer returned ${response.status}`);
  return (await response.json()) as { signedTx?: string };
};

export const broadcastTransfer = async (id: string, now = Date.now()) => {
  ensureTable();
  const row = db.prepare("SELECT * FROM payment_transfers WHERE id = ?").get(id) as (TransferRow & { unsigned_tx: string | null }) | undefined;
  if (!row || row.status !== "gassed" || !row.unsigned_tx) throw new TransferError("confirmation_pending", "Transfer is not ready to broadcast");
  const chain = row.chain === "ethereum" ? "ethereum" : "polygon";
  const invoice = db.prepare("SELECT address, derivation_index, token_contract FROM payment_invoices WHERE id = ?").get(row.invoice_id) as {
    address: string;
    derivation_index: number;
    token_contract: string;
  };
  const signed = await signerRequest({
    id,
    sweepId: id,
    invoiceId: row.invoice_id,
    chain,
    chainId: chainIdOf(chain),
    asset: "usdc",
    tokenContract: invoice.token_contract,
    fromAddress: invoice.address,
    derivationIndex: invoice.derivation_index,
    toAddress: row.to_address,
    baseUnits: row.base_units,
    nonce: 0,
    gasPrice: "0",
    gasLimit: 80_000,
    unsignedTx: row.unsigned_tx,
    signingHash: row.unsigned_tx,
  });
  if (!signed.signedTx) throw new TransferError("evm_payout_disabled", "Signer did not return a signed transaction");
  const rpc = rpcFor(chain);
  if ((await evmChainId(rpc)) !== chainIdOf(chain)) throw new TransferError("evm_payout_disabled", "Wrong chain id");
  const txHash = await rpc("eth_sendRawTransaction", [signed.signedTx]);
  if (typeof txHash !== "string") throw new TransferError("confirmation_pending", "RPC did not return a transaction hash");
  db.prepare("UPDATE payment_transfers SET status = 'broadcast', tx_hash = ?, updated_at = ? WHERE id = ?").run(txHash, now, id);
  return { id, status: "broadcast", txHash };
};

export const confirmTransfer = async (id: string, now = Date.now()) => {
  ensureTable();
  const row = db.prepare("SELECT * FROM payment_transfers WHERE id = ?").get(id) as TransferRow | undefined;
  if (!row?.tx_hash) throw new TransferError("confirmation_pending", "Transfer has not been broadcast");
  const chain = row.chain === "ethereum" ? "ethereum" : "polygon";
  const invoice = db.prepare("SELECT token_contract, address FROM payment_invoices WHERE id = ?").get(row.invoice_id) as { token_contract: string; address: string };
  const receipt = await getReceipt(rpcFor(chain), row.tx_hash);
  const moved = receipt?.status
    ? receipt.logs
        .filter((log) => log.contract === invoice.token_contract.toLowerCase() && log.to === row.to_address.toLowerCase())
        .reduce((sum, log) => sum + log.value, 0n)
    : 0n;
  if (!receipt?.status || moved < BigInt(row.base_units)) throw new TransferError("confirmation_pending", "The transfer receipt does not show the token arriving at the cold address");
  db.prepare("UPDATE payment_transfers SET status = 'confirmed', updated_at = ? WHERE id = ?").run(now, id);
  ensureAddressSweepTable();
  const sweepId = db.prepare("SELECT id FROM payment_address_sweeps WHERE chain = ? AND lower(from_address) = lower(?) AND broadcast_tx = ?").get(chain, invoice.address, row.tx_hash) as { id: string } | undefined;
  if (sweepId) confirmAddressSweep(sweepId.id, now);
  else db.prepare("UPDATE payment_addresses SET state = 'swept' WHERE lower(address) = lower(?)").run(invoice.address);
  return { id, status: "confirmed", receivedBaseUnits: moved.toString() };
};
