import { keccak_256 } from "@noble/hashes/sha3";
import { env } from "../lib/env.ts";
import { randomUUID } from "../lib/crypto.ts";
import { chainIdOf } from "./allowlist.ts";
import { balanceOf, createJsonRpc, evmChainId, type JsonRpc } from "./chain.ts";
import { sweepCandidates, markSwept, recordSweep } from "./store.ts";

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
  const cold = coldAddressFor(chain);
  if (!isAddress(cold)) throw new SweepError(`Configure one ${chain} cold address before sweeping`);
  const rpc = rpcFor(chain);
  if ((await evmChainId(rpc)) !== chainIdOf(chain)) throw new SweepError(`Refusing to sweep: ${chain} RPC returned the wrong chain id`);
  const plans: SweepPlan[] = [];
  for (const invoice of sweepCandidates(chain)) {
    const balance = await balanceOf(rpc, invoice.token_contract, invoice.address);
    const gas = await nativeBalance(rpc, invoice.address);
    if (balance <= 0n || gas <= 0n) continue;
    const nonce = hexToBigInt(await rpc("eth_getTransactionCount", [invoice.address, "pending"]));
    const gasPrice = hexToBigInt(await rpc("eth_gasPrice", []));
    if (nonce > BigInt(Number.MAX_SAFE_INTEGER)) throw new SweepError("Nonce is too large");
    const unsignedTx = unsignedTokenTransfer({
      nonce,
      gasPrice,
      gasLimit: BigInt(GAS_LIMIT),
      token: invoice.token_contract,
      to: cold,
      amount: balance,
      chainId: BigInt(chainIdOf(chain)),
    });
    const plan: SweepPlan = {
      id: randomUUID(),
      invoiceId: invoice.id,
      chain,
      chainId: chainIdOf(chain),
      asset: invoice.asset,
      tokenContract: invoice.token_contract,
      fromAddress: invoice.address,
      derivationIndex: invoice.derivation_index,
      toAddress: cold,
      baseUnits: balance.toString(),
      nonce: Number(nonce),
      gasPrice: gasPrice.toString(),
      gasLimit: GAS_LIMIT,
      unsignedTx,
      signingHash: bytesToHex(keccak_256(hexToBytes(unsignedTx))),
    };
    recordSweep({
      id: plan.id,
      invoiceId: plan.invoiceId,
      chain,
      asset: plan.asset,
      tokenContract: plan.tokenContract,
      fromAddress: plan.fromAddress,
      derivationIndex: plan.derivationIndex,
      toAddress: plan.toAddress,
      baseUnits: plan.baseUnits,
      nonce: plan.nonce,
      gasPrice: plan.gasPrice,
      gasLimit: plan.gasLimit,
      unsignedTx: plan.unsignedTx,
      now,
    });
    plans.push(plan);
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
  if (!markSwept(plan.invoiceId, txHash, now)) throw new SweepError("Invoice was already swept");
  return txHash;
};

export const runSweep = async (chain: "polygon" | "ethereum", now = Date.now()) => {
  const plans = await planSweeps(chain, now);
  const sent: Array<{ invoiceId: string; txHash: string }> = [];
  for (const plan of plans) sent.push({ invoiceId: plan.invoiceId, txHash: await broadcastSweep(plan, now) });
  return sent;
};
