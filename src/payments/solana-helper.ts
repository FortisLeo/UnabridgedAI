import { env } from "../lib/env.ts";
import { isSolanaAddress } from "./solana-ata.ts";

export class SolanaHelperError extends Error {}

const configuredOwners = () => {
  if (env.solanaOwnerPubkeys.length === 0) return null;
  const owners = new Set<string>();
  for (const owner of env.solanaOwnerPubkeys) {
    if (!isSolanaAddress(owner) || owners.has(owner)) return null;
    owners.add(owner);
  }
  return env.solanaOwnerPubkeys;
};

export const deriveSolanaOwner = (index: number) => {
  const owners = configuredOwners();
  const pubkey = owners?.[index];
  if (!pubkey) throw new SolanaHelperError("Solana public key is not configured");
  return pubkey;
};

export const solanaConfigured = () => configuredOwners() !== null;
