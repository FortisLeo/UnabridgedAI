import { db } from "../db/client.ts";
import { env } from "../lib/env.ts";
import { chainIdOf } from "./allowlist.ts";
import { createJsonRpc, evmChainId, getReceipt } from "./chain.ts";
import { broadcastSweep, confirmBroadcastSweeps, planSweeps, type SweepPlan } from "./evm-sweep.ts";
import { ensureAddressSweepTable } from "./address-sweeps.ts";

export class TransferError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

export const prepareTransferGas = async (chain: "polygon" | "ethereum", now = Date.now()) => {
  return (await planSweeps(chain, now)).map((plan) => ({
    id: plan.sweepId, chain, status: "planned", from_address: plan.fromAddress,
    to_address: plan.toAddress, base_units: plan.baseUnits,
  }));
};

export const broadcastTransfer = async (id: string, now = Date.now()) => {
  ensureAddressSweepTable();
  const row = db.prepare("SELECT * FROM payment_address_sweeps WHERE id = ? AND broadcast_tx IS NULL").get(id) as Record<string, any> | undefined;
  if (!row || (row.chain !== "ethereum" && row.chain !== "polygon")) throw new TransferError("confirmation_pending", "Address sweep is not ready to broadcast");
  const plan: SweepPlan = {
    id, sweepId: id, chain: row.chain, chainId: chainIdOf(row.chain), asset: row.asset,
    tokenContract: row.token_contract, fromAddress: row.from_address, derivationIndex: row.derivation_index,
    toAddress: row.to_address, baseUnits: row.base_units, nonce: row.nonce, gasPrice: row.gas_price,
    gasLimit: row.gas_limit, unsignedTx: row.unsigned_tx, signingHash: row.unsigned_tx,
  };
  return { id, status: "broadcast", txHash: await broadcastSweep(plan, now) };
};

export const confirmTransfer = async (id: string, now = Date.now()) => {
  ensureAddressSweepTable();
  const sweep = db.prepare("SELECT chain, confirmed_at FROM payment_address_sweeps WHERE id = ?").get(id) as { chain: "polygon" | "ethereum"; confirmed_at: number | null } | undefined;
  if (sweep) {
    await confirmBroadcastSweeps(sweep.chain, now);
    const row = db.prepare("SELECT confirmed_at, base_units FROM payment_address_sweeps WHERE id = ?").get(id) as { confirmed_at: number | null; base_units: string };
    if (row.confirmed_at == null) throw new TransferError("confirmation_pending", "Address sweep is not finalized");
    return { id, status: "confirmed", receivedBaseUnits: row.base_units };
  }
  // Read-only receipt reconciliation for transfers created before address-level sweeps.
  const exists = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'payment_transfers'").get();
  const row = exists ? db.prepare("SELECT * FROM payment_transfers WHERE id = ?").get(id) as { invoice_id: string; chain: "polygon" | "ethereum"; tx_hash: string; to_address: string; base_units: string } | undefined : undefined;
  if (!row?.tx_hash) throw new TransferError("confirmation_pending", "Transfer has not been broadcast");
  const invoice = db.prepare("SELECT token_contract FROM payment_invoices WHERE id = ?").get(row.invoice_id) as { token_contract: string };
  const url = (row.chain === "polygon" ? env.polygonRpcUrls : env.ethereumRpcUrls)[0];
  if (!url) throw new TransferError("evm_payout_disabled", "RPC is not configured");
  const rpc = createJsonRpc(url);
  if (await evmChainId(rpc) !== chainIdOf(row.chain)) throw new TransferError("evm_payout_disabled", "Wrong chain id");
  const receipt = await getReceipt(rpc, row.tx_hash);
  const moved = receipt?.status ? receipt.logs.filter((log) => log.contract === invoice.token_contract.toLowerCase() && log.to === row.to_address.toLowerCase()).reduce((sum, log) => sum + log.value, 0n) : 0n;
  if (moved < BigInt(row.base_units)) throw new TransferError("confirmation_pending", "Receipt does not show funds arriving at the destination");
  db.prepare("UPDATE payment_transfers SET status = 'confirmed', updated_at = ? WHERE id = ?").run(now, id);
  return { id, status: "confirmed", receivedBaseUnits: moved.toString() };
};
