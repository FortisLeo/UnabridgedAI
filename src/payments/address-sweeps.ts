import { db } from "../db/client.ts";
import { randomUUID } from "../lib/crypto.ts";

export type AddressSweepRow = {
  id: string;
  chain: string;
  asset: string;
  token_contract: string;
  from_address: string;
  derivation_index: number;
  to_address: string;
  base_units: string;
  nonce: number;
  gas_price: string;
  gas_limit: number;
  unsigned_tx: string;
  created_at: number;
  broadcast_tx: string | null;
  broadcast_at: number | null;
};

export const ensureAddressSweepTable = () => {
  db.exec(`CREATE TABLE IF NOT EXISTS payment_address_sweeps (
    id TEXT PRIMARY KEY,
    chain TEXT NOT NULL,
    asset TEXT NOT NULL,
    token_contract TEXT NOT NULL,
    from_address TEXT NOT NULL,
    derivation_index INTEGER NOT NULL,
    to_address TEXT NOT NULL,
    base_units TEXT NOT NULL,
    nonce INTEGER NOT NULL,
    gas_price TEXT NOT NULL,
    gas_limit INTEGER NOT NULL,
    unsigned_tx TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    broadcast_tx TEXT,
    broadcast_at INTEGER,
    confirmed_at INTEGER
  )`);
  db.exec("DROP INDEX IF EXISTS payment_address_sweeps_pending");
  db.exec("CREATE INDEX IF NOT EXISTS payment_address_sweeps_pending ON payment_address_sweeps (chain, confirmed_at, created_at)");
};

export const pendingAddressSweep = (chain: string, address: string, tokenContract: string) => {
  ensureAddressSweepTable();
  return db.prepare("SELECT id FROM payment_address_sweeps WHERE chain = ? AND lower(from_address) = lower(?) AND lower(token_contract) = lower(?) AND confirmed_at IS NULL").get(chain, address, tokenContract) as { id: string } | undefined;
};

export const recordAddressSweep = (input: Omit<AddressSweepRow, "broadcast_tx" | "broadcast_at" | "confirmed_at">) => {
  ensureAddressSweepTable();
  db.prepare(`INSERT INTO payment_address_sweeps
    (id, chain, asset, token_contract, from_address, derivation_index, to_address, base_units, nonce, gas_price, gas_limit, unsigned_tx, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    input.id, input.chain, input.asset, input.token_contract, input.from_address, input.derivation_index,
    input.to_address, input.base_units, input.nonce, input.gas_price, input.gas_limit, input.unsigned_tx, input.created_at,
  );
};

export const broadcastAddressSweep = (id: string, txHash: string, now: number) => {
  ensureAddressSweepTable();
  const result = db.prepare("UPDATE payment_address_sweeps SET broadcast_tx = ?, broadcast_at = ? WHERE id = ? AND broadcast_tx IS NULL").run(txHash, now, id);
  return result.changes === 1;
};

export const markAddressSwept = (chain: string, address: string) => {
  db.prepare("UPDATE payment_address_leases SET state = 'swept', quarantine_until = NULL WHERE chain = ? AND lower(address) = lower(?)").run(chain, address);
  db.prepare("UPDATE payment_addresses SET state = 'swept', reusable_at = NULL WHERE lower(address) = lower(?)").run(address);
};

export const confirmAddressSweep = (id: string, now: number) => {
  ensureAddressSweepTable();
  const result = db.transaction(() => {
    const row = db.prepare("SELECT chain, from_address FROM payment_address_sweeps WHERE id = ? AND broadcast_tx IS NOT NULL AND confirmed_at IS NULL").get(id) as { chain: string; from_address: string } | undefined;
    if (!row) return false;
    db.prepare("UPDATE payment_address_sweeps SET confirmed_at = ? WHERE id = ?").run(now, id);
    markAddressSwept(row.chain, row.from_address);
    return true;
  })();
  return result;
};

export const newSweepId = () => randomUUID();
