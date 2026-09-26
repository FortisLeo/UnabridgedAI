import { config } from "dotenv";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: join(root, ".env") });

const resolveDbPath = () => {
  const raw = process.env.DB_PATH ?? join(root, "unabridged.db");
  return isAbsolute(raw) ? raw : join(root, raw);
};

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

export const env = {
  port: Number(process.env.PORT ?? 3001),
  dbPath: resolveDbPath(),
  nodeEnv: process.env.NODE_ENV ?? "development",
  exaApiKey: process.env.EXA_API_KEY?.trim() ?? "",
  root,
  webRoot: join(root, "web"),
  webDist: join(root, "dist"),
  evmAccountXpub: process.env.EVM_ACCOUNT_XPUB?.trim() ?? "",
  ethereumRpcUrls: list(process.env.ETHEREUM_RPC_URLS),
  polygonRpcUrls: list(process.env.POLYGON_RPC_URLS),
  solanaRpcUrls: list(process.env.SOLANA_RPC_URLS),
  solanaOwnerPubkeys: list(process.env.SOLANA_OWNER_PUBKEYS),
  moneroWalletRpcUrl: process.env.MONERO_WALLET_RPC_URL?.trim() ?? "",
  moneroWalletRpcUser: process.env.MONERO_WALLET_RPC_USER?.trim() ?? "",
  moneroWalletRpcPassword: process.env.MONERO_WALLET_RPC_PASSWORD ?? "",
  paymentWatchMs: Number(process.env.PAYMENT_WATCH_MS ?? 15_000),
};

export const providerKeys = () =>
  (process.env.ZERO_ZERO_API_KEYS ?? process.env.ZERO_ZERO_API_KEY ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

export const isProduction = env.nodeEnv === "production";
