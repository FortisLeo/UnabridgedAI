import { config } from "dotenv";
import { dirname, isAbsolute, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
config({ path: join(root, ".env") });

const resolveDbPath = () => {
  const raw = process.env.DB_PATH ?? join(root, "unabridged.db");
  return isAbsolute(raw) ? raw : join(root, raw);
};

export const env = {
  port: Number(process.env.PORT ?? 3001),
  dbPath: resolveDbPath(),
  nodeEnv: process.env.NODE_ENV ?? "development",
  exaApiKey: process.env.EXA_API_KEY?.trim() ?? "",
  root,
  webRoot: join(root, "web"),
  webDist: join(root, "dist"),
};

export const providerKeys = () =>
  (process.env.ZERO_ZERO_API_KEYS ?? process.env.ZERO_ZERO_API_KEY ?? "")
    .split(",")
    .map((key) => key.trim())
    .filter(Boolean);

export const isProduction = env.nodeEnv === "production";
