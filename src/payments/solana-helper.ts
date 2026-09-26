import { env } from "../lib/env.ts";
import { isSolanaAddress } from "./solana-ata.ts";

export class SolanaHelperError extends Error {}

export const deriveSolanaOwner = async (index: number) => {
  if (!env.solanaHelperUrl || !env.solanaHelperToken) throw new SolanaHelperError("Solana helper is not configured");
  const response = await fetch(env.solanaHelperUrl.replace(/\/$/, "") + "/derive", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.solanaHelperToken}` },
    body: JSON.stringify({ index }),
  });
  if (!response.ok) throw new SolanaHelperError("Solana helper failed");
  const body = (await response.json()) as { index?: number; pubkey?: string };
  if (body.index !== index || !body.pubkey || !isSolanaAddress(body.pubkey)) throw new SolanaHelperError("Solana helper returned a bad key");
  return body.pubkey;
};

export const solanaConfigured = () => Boolean(env.solanaHelperUrl && env.solanaHelperToken);
