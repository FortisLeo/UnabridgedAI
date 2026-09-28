export const CHAINS = ["ethereum", "polygon", "solana", "monero"] as const;
export type Chain = (typeof CHAINS)[number];
export const ASSETS = ["usdt", "usdc", "usdt0", "xmr"] as const;
export type Asset = (typeof ASSETS)[number];

export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const TOKEN_PROGRAM_ID = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
export const ASSOCIATED_TOKEN_PROGRAM_ID = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";

export const QR_TTL_MS = 60 * 60 * 1000;
export const MONERO_CONFIRMATIONS = 10;
export const EVM_REORG_WINDOW = { ethereum: 128, polygon: 32 } as const;
export const SOLANA_REORG_SLOTS = 128;
export const MONERO_ACCOUNT = 0;
export const MONERO_HEIGHT_LAG_BLOCKS = 3;

export type AllowlistEntry = {
  chain: Chain;
  asset: Asset;
  contract: string | null;
  decimals: number;
  chainId: number | null;
};

const ENTRIES: AllowlistEntry[] = [
  { chain: "ethereum", asset: "usdt", contract: "0xdac17f958d2ee523a2206206994597c13d831ec7", decimals: 6, chainId: 1 },
  { chain: "ethereum", asset: "usdc", contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", decimals: 6, chainId: 1 },
  { chain: "polygon", asset: "usdt0", contract: "0xc2132d05d31c914a87c6611c10748aeb04b58e8f", decimals: 6, chainId: 137 },
  { chain: "polygon", asset: "usdc", contract: "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", decimals: 6, chainId: 137 },
  { chain: "solana", asset: "usdt", contract: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6, chainId: null },
  { chain: "solana", asset: "usdc", contract: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6, chainId: null },
  { chain: "monero", asset: "xmr", contract: null, decimals: 12, chainId: null },
];

export const REJECTED_CONTRACTS = new Set([
  "0x2791bca1f2de4661ed88a30c99a7a9449aa84174",
]);

export const resolvePair = (chain: string, asset: string): AllowlistEntry | null => {
  const normalizedChain = chain.trim().toLowerCase();
  let normalizedAsset = asset.trim().toLowerCase();
  if (normalizedChain === "polygon" && normalizedAsset === "usdt") normalizedAsset = "usdt0";
  return ENTRIES.find((entry) => entry.chain === normalizedChain && entry.asset === normalizedAsset) ?? null;
};

export const entryByContract = (chain: Chain, contract: string) =>
  ENTRIES.find((entry) => entry.chain === chain && entry.contract?.toLowerCase() === contract.toLowerCase()) ?? null;

export const chainIdOf = (chain: "ethereum" | "polygon") => (chain === "ethereum" ? 1 : 137);

export const isChain = (value: string): value is Chain => (CHAINS as readonly string[]).includes(value);
