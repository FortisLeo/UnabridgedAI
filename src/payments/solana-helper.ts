import { env } from "../lib/env.ts";
import { isSolanaAddress } from "./solana-ata.ts";

export class SolanaHelperError extends Error {}

export const deriveSolanaOwner = (index: number) => {
  const pubkey = env.solanaOwnerPubkeys[index];
  if (!pubkey || !isSolanaAddress(pubkey)) throw new SolanaHelperError("Solana public key is not configured");
  return pubkey;
};

export const solanaConfigured = () => env.solanaOwnerPubkeys.length > 0;
