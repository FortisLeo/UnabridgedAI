import { env } from "../lib/env.ts";

const ALLOWED = new Set([
  "create_address",
  "get_address",
  "get_address_index",
  "incoming_transfers",
  "get_transfers",
  "get_transfer_by_txid",
  "refresh",
  "get_height",
  "set_subaddress_lookahead",
  "store",
  "check_tx_key",
  "make_uri",
]);

export class WalletRpcError extends Error {}

export type SubaddressIndex = { major: number; minor: number };
export type IncomingTransfer = {
  amount: bigint;
  txHash: string;
  globalIndex: number | null;
  pubkey: string;
  major: number;
  minor: number;
  blockHeight: number;
  unlocked: boolean;
  frozen: boolean;
  spent: boolean;
};

export const walletRpc = async <T>(method: string, params: Record<string, unknown> = {}): Promise<T> => {
  if (!ALLOWED.has(method)) throw new WalletRpcError("Wallet method is not allowed");
  if (!env.moneroWalletRpcUrl) throw new WalletRpcError("Wallet RPC is not configured");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (env.moneroWalletRpcUser) {
    headers.authorization = `Basic ${Buffer.from(`${env.moneroWalletRpcUser}:${env.moneroWalletRpcPassword}`).toString("base64")}`;
  }
  const response = await fetch(env.moneroWalletRpcUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({ jsonrpc: "2.0", id: "0", method, params }),
  });
  if (!response.ok) throw new WalletRpcError("Wallet RPC failed");
  const body = (await response.json()) as { result?: T; error?: { message?: string } };
  if (body.error) throw new WalletRpcError(body.error.message ?? "Wallet RPC error");
  if (body.result === undefined) throw new WalletRpcError("Wallet RPC returned no result");
  return body.result;
};

export const createSubaddress = async (label: string) => {
  const result = await walletRpc<{ address: string; address_index: number }>("create_address", { account_index: 0, label, count: 1 });
  return { address: result.address, index: result.address_index };
};

export const addressIndex = async (address: string) => {
  const result = await walletRpc<{ index: SubaddressIndex }>("get_address_index", { address });
  return result.index;
};

export const makeUri = async (address: string, amount: string) => {
  const result = await walletRpc<{ uri: string }>("make_uri", { address, amount });
  return result.uri;
};

export const setLookahead = async (minor: number) => {
  await walletRpc("set_subaddress_lookahead", { major_idx: 0, minor_idx: minor });
};

export const walletHeight = async () => {
  const result = await walletRpc<{ height: number }>("get_height");
  return result.height;
};

export const refreshWallet = async () => {
  await walletRpc("refresh", {});
};

const asBigInt = (value: unknown) => {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^[0-9]+$/.test(value)) return BigInt(value);
  throw new WalletRpcError("Amount was not an integer");
};

export const incomingTransfers = async (minor: number): Promise<IncomingTransfer[]> => {
  const result = await walletRpc<{ transfers?: Array<Record<string, unknown>> }>("incoming_transfers", {
    transfer_type: "all",
    account_index: 0,
    subaddr_indices: [minor],
  });
  return (result.transfers ?? []).map((transfer) => {
    const index = (transfer.subaddr_index ?? {}) as { major?: number; minor?: number };
    return {
      amount: asBigInt(transfer.amount),
      txHash: String(transfer.tx_hash ?? ""),
      globalIndex: typeof transfer.global_index === "number" ? transfer.global_index : null,
      pubkey: String(transfer.pubkey ?? ""),
      major: index.major ?? -1,
      minor: index.minor ?? -1,
      blockHeight: Number(transfer.block_height ?? transfer.blockheight ?? 0),
      unlocked: Boolean(transfer.unlocked),
      frozen: Boolean(transfer.frozen),
      spent: Boolean(transfer.spent),
    };
  });
};

export const unlockTimeOf = async (txHash: string) => {
  const result = await walletRpc<{ transfer?: { unlock_time?: number }; transfers?: Array<{ unlock_time?: number }> }>("get_transfer_by_txid", {
    txid: txHash,
  });
  const direct = result.transfer?.unlock_time ?? result.transfers?.find((item) => item.unlock_time !== undefined)?.unlock_time;
  return direct ?? null;
};

export const isMainnetSubaddress = (address: string) => address.startsWith("8") && address.length >= 95;

export const moneroConfigured = () => Boolean(env.moneroWalletRpcUrl);
