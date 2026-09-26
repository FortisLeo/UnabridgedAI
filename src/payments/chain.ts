export type JsonRpc = (method: string, params: unknown[]) => Promise<unknown>;

export class RpcError extends Error {}

const hexToBigInt = (value: unknown) => {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) throw new RpcError("Expected a hex quantity");
  return BigInt(value);
};

const hexToNumber = (value: unknown) => {
  const parsed = hexToBigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER)) throw new RpcError("Block number is too large");
  return Number(parsed);
};

export const createJsonRpc = (url: string): JsonRpc => async (method, params) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new RpcError(`RPC ${response.status}`);
  const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
  if (body.error) throw new RpcError(body.error.message ?? "RPC error");
  return body.result;
};

export const evmChainId = async (rpc: JsonRpc) => hexToNumber(await rpc("eth_chainId", []));

export const finalizedHead = async (rpc: JsonRpc) => {
  const block = (await rpc("eth_getBlockByNumber", ["finalized", false])) as { number?: string; hash?: string } | null;
  if (!block?.number || !block.hash) throw new RpcError("Finalized head unavailable");
  return { height: hexToNumber(block.number), hash: block.hash.toLowerCase() };
};

export type TransferLog = {
  txHash: string;
  logIndex: number;
  blockNumber: number;
  blockHash: string;
  contract: string;
  to: string;
  value: bigint;
  removed: boolean;
};

export const getTransferLogs = async (rpc: JsonRpc, fromBlock: number, toBlock: number, contract: string, topics: string[]) => {
  const logs = (await rpc("eth_getLogs", [
    {
      fromBlock: `0x${fromBlock.toString(16)}`,
      toBlock: `0x${toBlock.toString(16)}`,
      address: contract,
      topics: [topics[0], null, topics.slice(1)],
    },
  ])) as Array<Record<string, unknown>>;
  return logs.map(parseTransferLog);
};

const parseTransferLog = (log: Record<string, unknown>): TransferLog => {
  const topics = Array.isArray(log.topics) ? log.topics.map(String) : [];
  const toTopic = topics[2] ?? "";
  return {
    txHash: String(log.transactionHash ?? "").toLowerCase(),
    logIndex: hexToNumber(log.logIndex),
    blockNumber: hexToNumber(log.blockNumber),
    blockHash: String(log.blockHash ?? "").toLowerCase(),
    contract: String(log.address ?? "").toLowerCase(),
    to: `0x${toTopic.slice(-40)}`.toLowerCase(),
    value: hexToBigInt(log.data),
    removed: Boolean(log.removed),
  };
};

export const getReceipt = async (rpc: JsonRpc, txHash: string) => {
  const receipt = (await rpc("eth_getTransactionReceipt", [txHash])) as {
    status?: string;
    blockHash?: string;
    blockNumber?: string;
    logs?: Array<Record<string, unknown>>;
  } | null;
  if (!receipt) return null;
  return {
    status: receipt.status === "0x1",
    blockHash: (receipt.blockHash ?? "").toLowerCase(),
    blockNumber: receipt.blockNumber ? hexToNumber(receipt.blockNumber) : 0,
    logs: (receipt.logs ?? []).map(parseTransferLog),
  };
};

const selector = (signature: string) => createSelector(signature);

const createSelector = async (signature: string) => {
  const { keccak_256 } = await import("@noble/hashes/sha3");
  return `0x${Buffer.from(keccak_256(signature)).subarray(0, 4).toString("hex")}`;
};

export const balanceOf = async (rpc: JsonRpc, contract: string, address: string) => {
  const data = `${await selector("balanceOf(address)")}${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;
  return hexToBigInt(await rpc("eth_call", [{ to: contract, data }, "finalized"]));
};

export const usdtFee = async (rpc: JsonRpc, contract: string) => {
  const call = async (signature: string) => {
    try {
      return hexToBigInt(await rpc("eth_call", [{ to: contract, data: await selector(signature) }, "finalized"]));
    } catch {
      return null;
    }
  };
  return { basisPointsRate: await call("basisPointsRate()"), maximumFee: await call("maximumFee()") };
};

export const solanaSlot = async (rpc: JsonRpc, commitment: "finalized" | "confirmed") => {
  const slot = await rpc("getSlot", [{ commitment }]);
  if (typeof slot !== "number") throw new RpcError("Expected a slot");
  return slot;
};

export type SolanaDelta = {
  signature: string;
  instructionIndex: number;
  mint: string;
  owner: string;
  delta: bigint;
  slot: number;
};

export const solanaSignatures = async (rpc: JsonRpc, address: string, until?: string) => {
  const result = (await rpc("getSignaturesForAddress", [address, { commitment: "finalized", limit: 100, ...(until ? { until } : {}) }])) as Array<{
    signature?: string;
    slot?: number;
    err?: unknown;
  }>;
  return result.filter((item) => item.signature && item.err == null).map((item) => ({ signature: item.signature as string, slot: item.slot ?? 0 }));
};

export const solanaTokenDeltas = async (rpc: JsonRpc, signature: string): Promise<SolanaDelta[]> => {
  const tx = (await rpc("getTransaction", [signature, { commitment: "finalized", encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }])) as {
    slot?: number;
    meta?: { preTokenBalances?: TokenBalance[]; postTokenBalances?: TokenBalance[] };
  } | null;
  if (!tx?.meta) return [];
  const pre = new Map((tx.meta.preTokenBalances ?? []).map((item) => [balanceKey(item), item]));
  const post = tx.meta.postTokenBalances ?? [];
  return post.flatMap((item, index) => {
    const before = pre.get(balanceKey(item));
    const delta = BigInt(item.uiTokenAmount.amount) - BigInt(before?.uiTokenAmount.amount ?? "0");
    if (delta === 0n) return [];
    return [{ signature, instructionIndex: index, mint: item.mint, owner: item.owner, delta, slot: tx.slot ?? 0 }];
  });
};

type TokenBalance = { accountIndex: number; mint: string; owner: string; uiTokenAmount: { amount: string } };
const balanceKey = (item: TokenBalance) => `${item.accountIndex}:${item.mint}:${item.owner}`;
