import { db } from "../db/client.ts";
import { randomUUID } from "../lib/crypto.ts";
import { INVOICE_USER_RATE } from "../lib/quota.ts";
import type { Asset, Chain } from "./allowlist.ts";

export type InvoiceRow = {
  id: string;
  user_id: string;
  chain: Chain;
  asset: Asset;
  token_contract: string | null;
  expected_base_units: string;
  address: string;
  derivation_index: number;
  status: string;
  qr_expires_at: number;
  created_at: number;
  updated_at: number;
  settled_at: number | null;
  grant_applied_at: number | null;
  already_pro: number;
  refund_address: string | null;
  refund_chain: string | null;
  refund_requested_at: number | null;
  note: string | null;
  uri: string | null;
  second_read_ok: number;
  swept_at: number | null;
  sweep_tx: string | null;
};

export type CreditRow = {
  id: string;
  invoice_id: string;
  chain: string;
  tx_hash: string;
  output_index: number;
  output_pubkey: string | null;
  from_address: string | null;
  base_units: string;
  height: number;
  block_hash: string | null;
  confirmations: number;
  locked: number;
  wrong_asset: number;
  settled: number;
  first_seen_at: number;
  settled_at: number | null;
  disappeared_at: number | null;
  confirmed_at: number | null;
};

const OPEN_FOR_CREATE = ["open", "underpaid", "exact_pending", "overpaid"];
export const EVM_POOL_SIZE = 30;
export const EVM_LEASE_MS = 30 * 60 * 1000;
export const EVM_QUARANTINE_MS = 2 * 60 * 60 * 1000;

export const blockingInvoice = (userId: string) =>
  db
    .prepare(`SELECT id FROM payment_invoices WHERE user_id = ? AND status IN (${OPEN_FOR_CREATE.map(() => "?").join(",")}) ORDER BY created_at DESC LIMIT 1`)
    .get(userId, ...OPEN_FOR_CREATE) as { id: string } | undefined;

export const userCreatesSince = (userId: string, since: number) =>
  (db.prepare("SELECT COUNT(*) AS count FROM payment_events WHERE user_id = ? AND kind = 'created' AND at > ?").get(userId, since) as { count: number }).count;

export const userCreateLimited = (userId: string, now: number) => userCreatesSince(userId, now - INVOICE_USER_RATE.windowMs) >= INVOICE_USER_RATE.max;

export const takeIndex = (family: "evm" | "solana" | "monero") => {
  const row = db.prepare("SELECT next_index FROM address_counters WHERE family = ?").get(family) as { next_index: number };
  db.prepare("UPDATE address_counters SET next_index = ? WHERE family = ?").run(row.next_index + 1, family);
  return row.next_index;
};

export const insertSkipped = (family: "evm" | "solana" | "monero", index: number, now: number) => {
  db.prepare("INSERT OR IGNORE INTO payment_addresses (address, family, derivation_index, ata, state, created_at) VALUES (?, ?, ?, NULL, 'skipped', ?)").run(
    `${family}:skipped:${index}`,
    family,
    index,
    now,
  );
};

export const availableEvmIndex = (chain: string, now: number) => {
  db.prepare("UPDATE payment_address_leases SET state = 'quarantined', quarantine_until = ? WHERE chain = ? AND state = 'leased' AND expires_at <= ?").run(now + EVM_QUARANTINE_MS, chain, now);
  const row = db.prepare(`SELECT a.derivation_index FROM payment_addresses a
    LEFT JOIN payment_address_leases l ON l.address = a.address AND l.chain = ?
    WHERE a.family = 'evm' AND a.derivation_index < ?
      AND (l.address IS NULL OR l.state = 'swept' OR (l.state = 'quarantined' AND l.quarantine_until <= ?))
    ORDER BY a.derivation_index ASC LIMIT 1`).get(chain, EVM_POOL_SIZE, now) as { derivation_index: number } | undefined;
  return row?.derivation_index ?? null;
};

export const ensureEvmAddress = (address: string, index: number, now: number) => {
  db.prepare("INSERT OR IGNORE INTO payment_addresses (address, family, derivation_index, ata, state, created_at) VALUES (?, 'evm', ?, NULL, 'available', ?)").run(address, index, now);
};

export const leaseEvmAddress = (address: string, chain: string, invoiceId: string, now: number) => {
  db.prepare(`INSERT INTO payment_address_leases (address, chain, invoice_id, state, leased_at, expires_at)
    VALUES (?, ?, ?, 'leased', ?, ?)
    ON CONFLICT(address, chain) DO UPDATE SET invoice_id = excluded.invoice_id, state = 'leased', leased_at = excluded.leased_at, expires_at = excluded.expires_at, quarantine_until = NULL`).run(address, chain, invoiceId, now, now + EVM_LEASE_MS);
  db.prepare("UPDATE payment_addresses SET state = 'assigned', lease_expires_at = ?, reusable_at = NULL WHERE address = ?").run(now + EVM_LEASE_MS, address);
};

export const releaseEvmLease = (invoiceId: string, paid: boolean, now: number) => {
  db.prepare("UPDATE payment_address_leases SET state = ?, quarantine_until = ? WHERE invoice_id = ?").run(paid ? "paid_pending_sweep" : "quarantined", paid ? null : now + EVM_QUARANTINE_MS, invoiceId);
  if (!paid) db.prepare("UPDATE payment_addresses SET state = 'quarantined', reusable_at = ? WHERE address = (SELECT address FROM payment_invoices WHERE id = ?)").run(now + EVM_QUARANTINE_MS, invoiceId);
};

export const insertAddress = (address: string, family: "evm" | "solana" | "monero", index: number, ata: string | null, now: number) => {
  db.prepare("INSERT INTO payment_addresses (address, family, derivation_index, ata, state, created_at, lease_expires_at) VALUES (?, ?, ?, ?, 'reserved', ?, ?)").run(
    address,
    family,
    index,
    ata,
    now,
    now + 30 * 60 * 1000,
  );
};

export const insertInvoice = (input: {
  id?: string;
  userId: string;
  chain: Chain;
  asset: Asset;
  tokenContract: string | null;
  expected: string;
  address: string;
  index: number;
  now: number;
  expiresAt: number;
  uri: string | null;
}) => {
  const id = input.id ?? randomUUID();
  db.prepare(
    `INSERT INTO payment_invoices (
      id, user_id, chain, asset, token_contract, expected_base_units, address, derivation_index, status,
      qr_expires_at, created_at, updated_at, uri
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
  ).run(id, input.userId, input.chain, input.asset, input.tokenContract, input.expected, input.address, input.index, input.expiresAt, input.now, input.now, input.uri);
  db.prepare("UPDATE payment_addresses SET state = 'assigned' WHERE address = ?").run(input.address);
  db.prepare("INSERT INTO payment_events (invoice_id, user_id, at, kind, detail) VALUES (?, ?, ?, 'created', ?)").run(
    id,
    input.userId,
    input.now,
    JSON.stringify({ chain: input.chain, asset: input.asset, index: input.index }),
  );
  return id;
};

export const getInvoice = (id: string) => db.prepare("SELECT * FROM payment_invoices WHERE id = ?").get(id) as InvoiceRow | undefined;

export const invoicesForUser = (userId: string) =>
  db.prepare("SELECT * FROM payment_invoices WHERE user_id = ? ORDER BY created_at DESC").all(userId) as InvoiceRow[];

export const creditsFor = (invoiceId: string) =>
  db.prepare("SELECT * FROM payment_credits WHERE invoice_id = ? ORDER BY first_seen_at ASC").all(invoiceId) as CreditRow[];

export const creditsForChain = (chain: string) =>
  db.prepare("SELECT * FROM payment_credits WHERE chain = ? AND disappeared_at IS NULL").all(chain) as CreditRow[];

export const watchedInvoices = () =>
  db
    .prepare("SELECT * FROM payment_invoices WHERE status NOT IN ('refunded') AND (status != 'succeeded' OR grant_applied_at IS NULL)")
    .all() as InvoiceRow[];

const creditKey = (chain: string, txHash: string, outputIndex: number, pubkey: string | null) => `${chain}:${txHash}:${outputIndex}:${pubkey ?? ""}`;

export const upsertCredit = (credit: Omit<CreditRow, "id" | "first_seen_at" | "settled_at" | "disappeared_at" | "confirmed_at"> & { now: number; receiptConfirmed: boolean }) => {
  const key = creditKey(credit.chain, credit.tx_hash, credit.output_index, credit.output_pubkey);
  const existing = db.prepare("SELECT id FROM payment_credits WHERE credit_key = ?").get(key) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      "UPDATE payment_credits SET confirmations = ?, locked = ?, wrong_asset = ?, settled = ?, settled_at = CASE WHEN ? = 1 THEN COALESCE(settled_at, ?) ELSE settled_at END, confirmed_at = COALESCE(confirmed_at, ?), disappeared_at = NULL, height = ?, block_hash = ? WHERE id = ?",
    ).run(credit.confirmations, credit.locked, credit.wrong_asset, credit.settled, credit.settled, credit.now, credit.receiptConfirmed ? credit.now : null, credit.height, credit.block_hash, existing.id);
    return existing.id;
  }
  const id = randomUUID();
  db.prepare(
    `INSERT INTO payment_credits (
      id, invoice_id, chain, tx_hash, output_index, output_pubkey, from_address, base_units, height, block_hash,
      confirmations, locked, wrong_asset, settled, first_seen_at, settled_at, confirmed_at, credit_key
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    credit.invoice_id,
    credit.chain,
    credit.tx_hash,
    credit.output_index,
    credit.output_pubkey,
    credit.from_address,
    credit.base_units,
    credit.height,
    credit.block_hash,
    credit.confirmations,
    credit.locked,
    credit.wrong_asset,
    credit.settled,
    credit.now,
    credit.settled ? credit.now : null,
    credit.receiptConfirmed ? credit.now : null,
    key,
  );
  return id;
};

export const markMissing = (invoiceId: string, chain: string, seenKeys: Set<string>, now: number) => {
  const rows = db.prepare("SELECT id, tx_hash, output_index, output_pubkey FROM payment_credits WHERE invoice_id = ? AND chain = ? AND disappeared_at IS NULL").all(
    invoiceId,
    chain,
  ) as Array<{ id: string; tx_hash: string; output_index: number; output_pubkey: string | null }>;
  for (const row of rows) {
    const key = `${row.tx_hash}:${row.output_index}:${row.output_pubkey ?? ""}`;
    if (!seenKeys.has(key)) db.prepare("UPDATE payment_credits SET disappeared_at = ? WHERE id = ?").run(now, row.id);
  }
};

export const cursorOf = (chain: string) =>
  db.prepare("SELECT height, block_hash FROM payment_cursors WHERE chain = ?").get(chain) as { height: number; block_hash: string | null } | undefined;

export const saveCursor = (chain: string, height: number, blockHash: string | null, now: number) => {
  db.prepare(
    "INSERT INTO payment_cursors (chain, height, block_hash, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(chain) DO UPDATE SET height = excluded.height, block_hash = excluded.block_hash, updated_at = excluded.updated_at",
  ).run(chain, height, blockHash, now);
};

export const priceOf = (key: "pro_price_cents" | "xmr_atomic_units") =>
  (db.prepare("SELECT value FROM payment_settings WHERE key = ?").get(key) as { value: string } | undefined)?.value;

export const setPrice = (key: "pro_price_cents" | "xmr_atomic_units", value: string) => {
  db.prepare("INSERT INTO payment_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
};

export const setRefundAddress = (invoiceId: string, address: string, chain: string, now: number) => {
  db.prepare("UPDATE payment_invoices SET refund_address = ?, refund_chain = ?, refund_requested_at = ?, updated_at = ? WHERE id = ?").run(
    address,
    chain,
    now,
    now,
    invoiceId,
  );
};

export const evmAddresses = () =>
  db.prepare("SELECT address, derivation_index FROM payment_addresses WHERE family = 'evm' AND state = 'assigned'").all() as Array<{
    address: string;
    derivation_index: number;
  }>;

export const invoiceByAddress = (address: string, chain?: string) =>
  (chain
    ? db.prepare("SELECT * FROM payment_invoices WHERE lower(address) = lower(?) AND chain = ? AND status NOT IN ('succeeded', 'expired_unpaid', 'refunded') ORDER BY created_at DESC LIMIT 1").get(address, chain)
    : db.prepare("SELECT * FROM payment_invoices WHERE lower(address) = lower(?) ORDER BY created_at DESC LIMIT 1").get(address)) as InvoiceRow | undefined;

export const paymentAddressExists = (address: string) => Boolean(db.prepare("SELECT 1 FROM payment_addresses WHERE lower(address) = lower(?)").get(address));

export const recordUnmatchedTransfer = (input: { chain: string; asset: string; tokenContract: string | null; txHash: string; outputIndex: number; toAddress: string; fromAddress: string | null; baseUnits: string; now: number }) => {
  db.prepare(`INSERT OR IGNORE INTO unmatched_transfers
    (id, chain, asset, token_contract, tx_hash, output_index, to_address, from_address, base_units, first_seen_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unreviewed')`).run(
    randomUUID(), input.chain, input.asset, input.tokenContract, input.txHash, input.outputIndex, input.toAddress, input.fromAddress, input.baseUnits, input.now,
  );
};

export const recordChainHealth = (chain: string, status: string, error: string | null, blockHeight: number | null, now = Date.now()) => {
  db.prepare(`INSERT INTO chain_health (chain, status, last_success_at, last_error, block_height, updated_at)
    VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chain) DO UPDATE SET status = excluded.status, last_success_at = excluded.last_success_at, last_error = excluded.last_error, block_height = excluded.block_height, updated_at = excluded.updated_at`).run(
    chain, status, status === "ok" ? now : null, error, blockHeight, now,
  );
};

export const ataOf = (address: string) =>
  (db.prepare("SELECT ata FROM payment_addresses WHERE address = ?").get(address) as { ata: string | null } | undefined)?.ata ?? null;

export type SweepCandidate = InvoiceRow & { token_contract: string };

export const sweepCandidates = (chain: "polygon" | "ethereum") =>
  db
    .prepare(
      `SELECT * FROM payment_invoices
       WHERE chain = ? AND status = 'succeeded' AND grant_applied_at IS NOT NULL AND swept_at IS NULL AND token_contract IS NOT NULL
       ORDER BY grant_applied_at ASC`,
    )
    .all(chain) as SweepCandidate[];

export const recordSweep = (input: {
  id: string;
  invoiceId: string;
  chain: string;
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
  now: number;
}) => {
  db.prepare(
    `INSERT INTO payment_sweeps (
      id, invoice_id, chain, asset, token_contract, from_address, derivation_index, to_address, base_units,
      nonce, gas_price, gas_limit, unsigned_tx, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    input.id,
    input.invoiceId,
    input.chain,
    input.asset,
    input.tokenContract,
    input.fromAddress,
    input.derivationIndex,
    input.toAddress,
    input.baseUnits,
    input.nonce,
    input.gasPrice,
    input.gasLimit,
    input.unsignedTx,
    input.now,
  );
};

export const addressPoolRows = (now = Date.now()) => db.prepare(`SELECT a.*, l.chain AS lease_chain, l.invoice_id AS lease_invoice_id, l.state AS lease_state, l.expires_at AS lease_expires_at, l.quarantine_until FROM payment_addresses a LEFT JOIN payment_address_leases l ON l.address = a.address ORDER BY a.family, a.derivation_index, l.chain`).all(now);

export const markSwept = (invoiceId: string, txHash: string, now: number) => {
  const changed = db
    .prepare("UPDATE payment_invoices SET swept_at = ?, sweep_tx = ?, updated_at = ? WHERE id = ? AND swept_at IS NULL")
    .run(now, txHash, now, invoiceId);
  if (changed.changes !== 1) return false;
  db.prepare("UPDATE payment_sweeps SET broadcast_tx = ?, broadcast_at = ? WHERE invoice_id = ? AND broadcast_tx IS NULL").run(txHash, now, invoiceId);
  db.prepare("UPDATE payment_addresses SET state = 'swept', reusable_at = NULL WHERE address = (SELECT address FROM payment_invoices WHERE id = ?)").run(invoiceId);
  db.prepare("UPDATE payment_address_leases SET state = 'swept' WHERE invoice_id = ?").run(invoiceId);
  return true;
};
