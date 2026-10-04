import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "uai-pay-")), "test.db");
process.env.EVM_ACCOUNT_XPUB = "xpub6C4eGKm8ckhxJkW3c7s8g2h6m6Yk1nQdummy";

const { displayAmount, parseBaseUnits, stablecoinQuote } = await import("./amounts.ts");
const { resolvePair, REJECTED_CONTRACTS } = await import("./allowlist.ts");
const { classify } = await import("./settle.ts");
const { deriveEvmAddress } = await import("./evm-address.ts");

assert.equal(stablecoinQuote(1500n).toString(), "15000000");
assert.equal(displayAmount(15000000n, 6), "15.000000");
assert.equal(displayAmount(1n, 12), "0.000000000001");
assert.throws(() => parseBaseUnits("1.5"));
assert.throws(() => parseBaseUnits("-1"));

assert.equal(resolvePair("polygon", "usdt")?.asset, "usdt0");
assert.equal(resolvePair("polygon", "usdt")?.contract, "0xc2132d05d31c914a87c6611c10748aeb04b58e8f");
assert.equal(resolvePair("ethereum", "usdt0"), null);
assert.equal(resolvePair("monero", "xmr")?.contract, null);
assert.equal(resolvePair("monad", "usdt"), null);
assert.equal(REJECTED_CONTRACTS.has("0x2791bca1f2de4661ed88a30c99a7a9449aa84174"), true);

const invoice = {
  id: "inv",
  user_id: "user",
  chain: "ethereum" as const,
  asset: "usdc" as const,
  token_contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  expected_base_units: "15000000",
  address: "0xabc",
  derivation_index: 1,
  status: "open",
  qr_expires_at: 5_000,
  created_at: 1,
  updated_at: 1,
  settled_at: null,
  grant_applied_at: null,
  already_pro: 0,
  refund_address: null,
  refund_chain: null,
  refund_requested_at: null,
  note: null,
  uri: null,
  second_read_ok: 0,
  swept_at: null,
  sweep_tx: null,
};

const credit = {
  id: "c",
  invoice_id: "inv",
  chain: "ethereum",
  tx_hash: "0x1",
  output_index: 0,
  output_pubkey: null,
  from_address: null,
  base_units: "15000000",
  height: 10,
  block_hash: "0xb",
  confirmations: 100,
  locked: 0,
  wrong_asset: 0,
  settled: 1,
  first_seen_at: 100,
  settled_at: 100,
  disappeared_at: null,
  confirmed_at: 100,
};

assert.equal(classify(invoice, [{ ...credit, first_seen_at: 2_000 }], 2_000, true), "exact_pending");
assert.equal(classify(invoice, [credit], 2_000, true), "succeeded");
assert.equal(classify(invoice, [credit], 2_000, false), "exact_pending");
assert.equal(classify(invoice, [credit, { ...credit, id: "pending", tx_hash: "0x2", settled: 0, base_units: "1" }], 2_000, true), "succeeded");
assert.equal(classify(invoice, [{ ...credit, base_units: "14999999" }], 2_000, true), "underpaid");
assert.equal(classify(invoice, [{ ...credit, base_units: "15000001" }], 2_000, true), "succeeded");
const extra = (id: string, hash: string, units = "10000") => ({ ...credit, id, tx_hash: hash, base_units: units });
const polygon = { ...invoice, chain: "polygon" as const, asset: "usdc" as const, expected_base_units: "10000" };
const fourCredits = [extra("c1", "0xa"), extra("c2", "0xb"), extra("c3", "0xc"), extra("c4", "0xd")];
assert.equal(classify(polygon, fourCredits, 2_000, true), "succeeded");
assert.equal(classify(polygon, fourCredits.slice(0, 1), 2_000, true), "succeeded");
assert.equal(classify(polygon, fourCredits, 2_000, false), "overpaid");
assert.equal(classify(polygon, [extra("short", "0xe", "9999")], 2_000, true), "underpaid");
assert.equal(classify(polygon, fourCredits.map((item) => ({ ...item, settled: 0 })), 2_000, true), "overpaid");
assert.equal(classify(polygon, [...fourCredits, { ...extra("dust", "0xf", "1"), settled: 0 }], 2_000, true), "succeeded");
assert.equal(classify(polygon, [extra("c1", "0xa"), extra("c2", "0xb", "1")], 2_000, true), "succeeded");
assert.equal(classify(invoice, [{ ...credit, wrong_asset: 1, base_units: "15000000", settled: 0 }], 2_000, true), "wrong_asset");
assert.equal(classify(invoice, [{ ...credit, settled: 0 }], 2_000, true), "exact_pending");
assert.equal(classify({ ...invoice, qr_expires_at: 100 }, [], 2_000, true), "expired_unpaid");
assert.equal(classify({ ...invoice, chain: "monero", asset: "xmr" }, [{ ...credit, chain: "monero", locked: 1, wrong_asset: 1, settled: 0 }], 2_000, true), "wrong_asset");

const xpub = "xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5";
const first = deriveEvmAddress(xpub, 0);
const second = deriveEvmAddress(xpub, 1);
assert.notEqual(first, second);
assert.match(first, /^0x[0-9a-fA-F]{40}$/);
assert.equal(deriveEvmAddress(xpub, 0), first);
assert.throws(() => deriveEvmAddress(xpub.replace("xpub", "xprv"), 0));

const { db, closeDb } = await import("../db/client.ts");
const { applySettlement } = await import("./settle.ts");
const { takeIndex } = await import("./store.ts");

const payer = "overpay-user";
db.prepare("INSERT INTO users (id, username, password_hash, plan, created_at) VALUES (?, 'overpay', 'x', 'free', 1)").run(payer);
const depositAddress = "0x3333333333333333333333333333333333333333";
db.prepare("INSERT INTO payment_addresses (address, family, derivation_index, ata, state, created_at) VALUES (?, 'evm', 8, NULL, 'assigned', 1)").run(depositAddress);
db.prepare(
  `INSERT INTO payment_invoices (
    id, user_id, chain, asset, token_contract, expected_base_units, address, derivation_index, status,
    qr_expires_at, created_at, updated_at
  ) VALUES ('0211316c-6b7f-4231-b3a0-2cd348e0467d', ?, 'polygon', 'usdc', '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359', '10000', ?, 8, 'open', 9000, 1, 1)`,
).run(payer, depositAddress);
const insertCredit = (id: string, hash: string, units: string, settled: number) => {
  db.prepare(
    `INSERT INTO payment_credits (
      id, invoice_id, chain, tx_hash, output_index, base_units, height, confirmations, locked, wrong_asset, settled, first_seen_at, settled_at, credit_key
    ) VALUES (?, '0211316c-6b7f-4231-b3a0-2cd348e0467d', 'polygon', ?, 0, ?, 10, 100, 0, 0, ?, 100, ?, ?)`,
  ).run(id, hash, units, settled, settled ? 100 : null, `polygon:${hash}:0:`);
};
insertCredit("short", "0xshort", "9999", 1);
const storedInvoice = () => db.prepare("SELECT * FROM payment_invoices WHERE id = '0211316c-6b7f-4231-b3a0-2cd348e0467d'").get() as typeof invoice;
const storedCredits = () => db.prepare("SELECT * FROM payment_credits WHERE invoice_id = '0211316c-6b7f-4231-b3a0-2cd348e0467d'").all() as Array<typeof credit>;
assert.equal(applySettlement(storedInvoice(), storedCredits(), 2_000, true).granted, false);
assert.equal((db.prepare("SELECT plan FROM users WHERE id = ?").get(payer) as { plan: string }).plan, "free");
db.prepare("DELETE FROM payment_credits WHERE id = 'short'").run();
for (const [id, hash] of [["c1", "0xa"], ["c2", "0xb"], ["c3", "0xc"], ["c4", "0xd"]] as const) insertCredit(id, hash, "10000", 0);
assert.equal(applySettlement(storedInvoice(), storedCredits(), 2_000, true).status, "overpaid");
assert.equal((db.prepare("SELECT plan FROM users WHERE id = ?").get(payer) as { plan: string }).plan, "free");
db.prepare("UPDATE payment_credits SET settled = 1, settled_at = 100 WHERE invoice_id = '0211316c-6b7f-4231-b3a0-2cd348e0467d'").run();
insertCredit("dust", "0xf", "1", 0);
assert.equal(applySettlement(storedInvoice(), storedCredits(), 2_000, false).status, "overpaid");
assert.equal((db.prepare("SELECT plan FROM users WHERE id = ?").get(payer) as { plan: string }).plan, "free");
const settled = applySettlement(storedInvoice(), storedCredits(), 2_000, true);
assert.equal(settled.status, "succeeded");
assert.equal(settled.granted, true);
assert.equal((db.prepare("SELECT plan FROM users WHERE id = ?").get(payer) as { plan: string }).plan, "pro");
const grantAt = (db.prepare("SELECT grant_applied_at FROM payment_invoices WHERE id = '0211316c-6b7f-4231-b3a0-2cd348e0467d'").get() as { grant_applied_at: number }).grant_applied_at;
assert.equal(applySettlement(storedInvoice(), storedCredits(), 3_000, true).granted, true);
assert.equal((db.prepare("SELECT grant_applied_at FROM payment_invoices WHERE id = '0211316c-6b7f-4231-b3a0-2cd348e0467d'").get() as { grant_applied_at: number }).grant_applied_at, grantAt);
assert.equal(takeIndex("monero"), 1);
assert.equal((db.prepare("SELECT next_index FROM address_counters WHERE family = 'monero'").get() as { next_index: number }).next_index, 2);

const { availableEvmIndex, ensureEvmAddress, leaseEvmAddress } = await import("./store.ts");
const poolUser = "pool-user";
db.prepare("INSERT INTO users (id, username, password_hash, plan, created_at) VALUES (?, 'pool', 'x', 'free', 1)").run(poolUser);
const poolAddress = (index: number) => `0x${(index + 100).toString(16).padStart(40, "0")}`;
const poolInvoice = (index: number, status: string, qrExpiresAt: number) => {
  const address = poolAddress(index);
  ensureEvmAddress(address, index, 1);
  db.prepare(
    `INSERT INTO payment_invoices (id, user_id, chain, asset, token_contract, expected_base_units, address, derivation_index, status, qr_expires_at, created_at, updated_at)
     VALUES (?, ?, 'ethereum', 'usdc', '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', '15000000', ?, ?, ?, ?, 1, 1)`,
  ).run(`pool-${index}`, poolUser, address, index, status, qrExpiresAt);
  return address;
};
const clearPool = (...indices: number[]) => {
  for (const index of indices) {
    db.prepare("DELETE FROM payment_invoices WHERE id = ?").run(`pool-${index}`);
    db.prepare("DELETE FROM payment_address_leases WHERE address = ?").run(poolAddress(index));
    db.prepare("DELETE FROM payment_addresses WHERE address = ?").run(poolAddress(index));
  }
};

// An address whose lease lapsed while its invoice is still payable must not be handed to a new invoice.
const openAddress = poolInvoice(0, "open", 60_000);
leaseEvmAddress(openAddress, "ethereum", "pool-0", 0, 60_000);
assert.notEqual(availableEvmIndex("ethereum", 61_000), 0);
assert.notEqual(availableEvmIndex("ethereum", 60_000 + 15 * 60 * 1000), 0);
clearPool(0);

// A legacy address with no lease row but still backing an open invoice must not be reused.
poolInvoice(1, "open", 60_000);
assert.notEqual(availableEvmIndex("ethereum", 1_000), 1);
assert.equal(availableEvmIndex("ethereum", 10_000_000), 1);
clearPool(1);

// Quarantine runs from the invoice's actual payment expiry, not the lease timestamp.
const expiredAddress = poolInvoice(2, "expired_unpaid", 60_000);
leaseEvmAddress(expiredAddress, "ethereum", "pool-2", 0, 60_000);
assert.notEqual(availableEvmIndex("ethereum", 60_000 + 19 * 60 * 1000), 2);
assert.equal(availableEvmIndex("ethereum", 60_000 + 21 * 60 * 1000), 2);
clearPool(2);

// A paid invoice keeps its address until its address sweep confirms, then it is reusable without invoice hacked columns.
const paidAddress = poolInvoice(3, "succeeded", 60_000);
leaseEvmAddress(paidAddress, "ethereum", "pool-3", 0, 60_000);
db.prepare("UPDATE payment_address_leases SET state = 'paid_pending_sweep', quarantine_until = NULL WHERE address = ?").run(paidAddress);
assert.notEqual(availableEvmIndex("ethereum", 60_000 + 60 * 60 * 1000), 3);
const { ensureAddressSweepTable, recordAddressSweep, broadcastAddressSweep, confirmAddressSweep, pendingAddressSweep, markAddressSwept } = await import("./address-sweeps.ts");
ensureAddressSweepTable();
const paidSweep = "sweep-pool-3";
recordAddressSweep({ id: paidSweep, chain: "ethereum", asset: "usdc", token_contract: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", from_address: paidAddress, derivation_index: 3, to_address: "0x2222222222222222222222222222222222222222", base_units: "15000000", nonce: 0, gas_price: "1", gas_limit: 80000, unsigned_tx: "0xdead", created_at: 61_000 });
assert.equal(pendingAddressSweep("ethereum", paidAddress, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")?.id, paidSweep);
assert.equal(broadcastAddressSweep(paidSweep, "0xfeed", 61_000), true);
// Dedup keeps covering broadcast-but-unconfirmed sweeps so a second sweep is never planned for the same balance.
assert.equal(pendingAddressSweep("ethereum", paidAddress, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48")?.id, paidSweep);
assert.equal(confirmAddressSweep(paidSweep, 62_000), true);
assert.equal(pendingAddressSweep("ethereum", paidAddress, "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"), undefined);
assert.equal(availableEvmIndex("ethereum", 60_000 + 21 * 60 * 1000), 3);
clearPool(3);

// markAddressSwept is the shared confirmation boundary and also advances a legacy lease-less lease row.
const legacyAddress = poolInvoice(4, "succeeded", 60_000);
markAddressSwept("ethereum", legacyAddress);
assert.equal((db.prepare("SELECT state FROM payment_addresses WHERE address = ?").get(legacyAddress) as { state: string }).state, "swept");
const nextIndex = takeIndex("evm");
assert.notEqual(nextIndex, 4);
clearPool(4);
closeDb();

console.log("payment tests passed");
