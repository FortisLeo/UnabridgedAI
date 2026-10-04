import { keccak_256 } from "@noble/hashes/sha3";
import { env } from "../lib/env.ts";
import { db } from "../db/client.ts";
import { randomUUID } from "../lib/crypto.ts";
import { chainIdOf } from "./allowlist.ts";
import { balanceOf, createJsonRpc, evmChainId, getReceipt, type JsonRpc } from "./chain.ts";
import { addressPoolRows } from "./store.ts";
import { broadcastAddressSweep, confirmAddressSweep, ensureAddressSweepTable, newSweepId, pendingAddressSweep, recordAddressSweep } from "./address-sweeps.ts";

const TRANSFER_SELECTOR = "a9059cbb";
const GAS_LIMIT = 80_000;

export class SweepError extends Error {}

const isAddress = (value: string) => /^0x[0-9a-fA-F]{40}$/.test(value);

const hexQuantity = (value: bigint | number) => {
  if (value < 0n) throw new SweepError("Negative quantity");
  return `0x${value.toString(16)}`;
};

const hexToBigInt = (value: unknown) => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) throw new SweepError("Expected a hex quantity");
  return BigInt(value);
};

const rlp = (items: Array<Uint8Array | Array<Uint8Array>>): Uint8Array => {
  const encoded = items.map((item) => (item instanceof Uint8Array ? rlpString(item) : rlp(item)));
  return concat([lengthPrefix(0xc0, encoded.reduce((sum, item) => sum + item.length, 0)), ...encoded]);
};

const rlpString = (bytes: Uint8Array) => {
  if (bytes.length === 1 && bytes[0]! < 0x80) return bytes;
  return concat([lengthPrefix(0x80, bytes.length), bytes]);
};

const lengthPrefix = (offset: number, length: number) => {
  if (length < 56) return Uint8Array.of(offset + length);
  const size = hexToBytes(length.toString(16).padStart(2, "0"));
  return concat([Uint8Array.of(offset + 55 + size.length), size]);
};

const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

const hexToBytes = (hex: string) => {
  const clean = hex.replace(/^0x/, "");
  if (clean.length % 2 !== 0) throw new SweepError("Odd hex length");
  return Uint8Array.from(Buffer.from(clean, "hex"));
};

const bytesToHex = (bytes: Uint8Array) => `0x${Buffer.from(bytes).toString("hex")}`;

export const unsignedTokenTransfer = (input: { nonce: bigint; gasPrice: bigint; gasLimit: bigint; token: string; to: string; amount: bigint; chainId: bigint }) =>
  bytesToHex(
    unsignedLegacy({
      nonce: input.nonce,
      gasPrice: input.gasPrice,
      gasLimit: input.gasLimit,
      to: input.token,
      value: 0n,
      data: transferData(input.to, input.amount),
      chainId: input.chainId,
    }),
  );

const unsignedLegacy = (input: { nonce: bigint; gasPrice: bigint; gasLimit: bigint; to: string; value: bigint; data: Uint8Array; chainId: bigint }) =>
  rlp([
    quantityBytes(input.nonce),
    quantityBytes(input.gasPrice),
    quantityBytes(input.gasLimit),
    hexToBytes(input.to),
    quantityBytes(input.value),
    input.data,
    quantityBytes(input.chainId),
    new Uint8Array(),
    new Uint8Array(),
  ]);

const quantityBytes = (value: bigint) => {
  if (value === 0n) return new Uint8Array();
  const hex = value.toString(16);
  return hexToBytes(hex.length % 2 === 0 ? hex : `0${hex}`);
};

const transferData = (to: string, amount: bigint) => hexToBytes(`${TRANSFER_SELECTOR}${to.toLowerCase().replace(/^0x/, "").padStart(64, "0")}${amount.toString(16).padStart(64, "0")}`);

export type SweepPlan = {
  id: string;
  invoiceId: string;
  sweepId: string;
  chain: "polygon" | "ethereum";
  chainId: number;
  asset: string;
  tokenContract: string;
  fromAddress: string;
  derivationIndex: number;
  toAddress: string;
  baseUnits: string;
  nonce: number;
  gasPrice: string;
  gasLimit: number;
  unsignedTx: string;
  signingHash: string;
};

const coldAddressFor = (chain: "polygon" | "ethereum") => (chain === "polygon" ? env.polygonColdAddress : env.ethereumColdAddress);

const rpcFor = (chain: "polygon" | "ethereum") => {
  const url = (chain === "polygon" ? env.polygonRpcUrls : env.ethereumRpcUrls)[0];
  if (!url) throw new SweepError(`${chain} RPC is not configured`);
  return createJsonRpc(url);
};

export const planSweeps = async (chain: "polygon" | "ethereum", now = Date.now()): Promise<SweepPlan[]> => {
  ensureAddressSweepTable();
  const cold = coldAddressFor(chain);
  if (!isAddress(cold)) throw new SweepError(`Configure one ${chain} cold address before sweeping`);
  const rpc = rpcFor(chain);
  if ((await evmChainId(rpc)) !== chainIdOf(chain)) throw new SweepError(`Refusing to sweep: ${chain} RPC returned the wrong chain id`);
  const plans: SweepPlan[] = [];
  const addresses = addressPoolRows().filter((row: any) => row.family === "evm" && row.lease_chain === chain);
  for (const address of addresses as any[]) {
    const candidates = db.prepare("SELECT token_contract, asset, derivation_index, id FROM payment_invoices WHERE chain = ? AND lower(address) = lower(?) AND token_contract IS NOT NULL GROUP BY token_contract, asset, derivation_index ORDER BY created_at DESC").all(chain, address.address) as Array<{ token_contract: string; asset: string; derivation_index: number; id: string }>;
    for (const candidate of candidates) {
      if (pendingAddressSweep(chain, address.address, candidate.token_contract)) continue;
      const balance = await balanceOf(rpc, candidate.token_contract, address.address);
      const gas = await nativeBalance(rpc, address.address);
      if (balance <= 0n || gas <= 0n) continue;
      const nonce = hexToBigInt(await rpc("eth_getTransactionCount", [address.address, "pending"]));
      const gasPrice = hexToBigInt(await rpc("eth_gasPrice", []));
      if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) throw new SweepError("Nonce is too large");
      const unsignedTx = unsignedTokenTransfer({ nonce, gasPrice, gasLimit: BigInt(GAS_LIMIT), token: candidate.token_contract, to: cold, amount: balance, chainId: BigInt(chainIdOf(chain)) });
      const sweepId = newSweepId();
      const plan: SweepPlan = { id: sweepId, sweepId, invoiceId: candidate.id, chain, chainId: chainIdOf(chain), asset: candidate.asset, tokenContract: candidate.token_contract, fromAddress: address.address, derivationIndex: candidate.derivation_index, toAddress: cold, baseUnits: balance.toString(), nonce: Number(nonce), gasPrice: gasPrice.toString(), gasLimit: GAS_LIMIT, unsignedTx, signingHash: bytesToHex(keccak_256(hexToBytes(unsignedTx))) };
      recordAddressSweep({ id: sweepId, chain, asset: plan.asset, token_contract: plan.tokenContract, from_address: plan.fromAddress, derivation_index: plan.derivationIndex, to_address: plan.toAddress, base_units: plan.baseUnits, nonce: plan.nonce, gas_price: plan.gasPrice, gas_limit: plan.gasLimit, unsigned_tx: plan.unsignedTx, created_at: now });
      plans.push(plan);
    }
  }
  return plans;
};

const nativeBalance = async (rpc: JsonRpc, address: string) => hexToBigInt(await rpc("eth_getBalance", [address, "latest"]));

const signerRequest = async (path: string, body: unknown) => {
  let origin = "";
  try {
    origin = new URL(env.sweepSignerUrl).origin;
  } catch {
    origin = "";
  }
  if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/i.test(origin)) {
    throw new SweepError("Sweep signer must be an explicit localhost URL");
  }
  const response = await fetch(new URL(path, env.sweepSignerUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new SweepError(`Sweep signer returned ${response.status}`);
  return (await response.json()) as { signedTx?: string };
};

export const broadcastSweep = async (plan: SweepPlan, now = Date.now()) => {
  const signed = await signerRequest("/sign", { unsignedTx: plan.unsignedTx, fromAddress: plan.fromAddress, derivationIndex: plan.derivationIndex, chainId: plan.chainId });
  if (!signed.signedTx || !/^0x[0-9a-fA-F]+$/.test(signed.signedTx)) throw new SweepError("Signer did not return a signed transaction");
  const rpc = rpcFor(plan.chain);
  const txHash = await rpc("eth_sendRawTransaction", [signed.signedTx]);
  if (typeof txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new SweepError("RPC did not return a transaction hash");
  if (!broadcastAddressSweep(plan.sweepId, txHash, now)) throw new SweepError("Address sweep was already broadcast");
  return txHash;
};

export const confirmBroadcastSweeps = async (chain: "polygon" | "ethereum", now = Date.now()) => {
  ensureAddressSweepTable();
  const pending = db.prepare("SELECT id, broadcast_tx, token_contract, to_address, base_units FROM payment_address_sweeps WHERE chain = ? AND broadcast_tx IS NOT NULL AND confirmed_at IS NULL").all(chain) as Array<{
    id: string;
    broadcast_tx: string;
    token_contract: string;
    to_address: string;
    base_units: string;
  }>;
  if (pending.length === 0) return 0;
  const rpc = rpcFor(chain);
  let confirmed = 0;
  for (const sweep of pending) {
    const receipt = await getReceipt(rpc, sweep.broadcast_tx);
    const moved = receipt?.status
      ? receipt.logs
          .filter((log) => log.contract === sweep.token_contract.toLowerCase() && log.to === sweep.to_address.toLowerCase())
          .reduce((sum, log) => sum + log.value, 0n)
      : 0n;
    if (!receipt?.status || moved < BigInt(sweep.base_units)) continue;
    if (confirmAddressSweep(sweep.id, now)) confirmed += 1;
  }
  return confirmed;
};

export const runSweep = async (chain: "polygon" | "ethereum", now = Date.now()) => {
  await confirmBroadcastSweeps(chain, now);
  const plans = await planSweeps(chain, now);
  const sent: Array<{ sweepId: string; txHash: string }> = [];
  for (const plan of plans) sent.push({ sweepId: plan.sweepId, txHash: await broadcastSweep(plan, now) });
  return sent;
};
