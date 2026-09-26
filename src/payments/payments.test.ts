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
};

assert.equal(classify(invoice, [{ ...credit, first_seen_at: 2_000 }], 2_000, true), "exact_pending");
assert.equal(classify(invoice, [credit], 2_000, true), "succeeded");
assert.equal(classify(invoice, [credit], 2_000, false), "exact_pending");
assert.equal(classify(invoice, [{ ...credit, base_units: "14999999" }], 2_000, true), "underpaid");
assert.equal(classify(invoice, [{ ...credit, base_units: "15000001" }], 2_000, true), "overpaid");
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
const { takeIndex } = await import("./store.ts");
assert.equal(takeIndex("monero"), 1);
assert.equal((db.prepare("SELECT next_index FROM address_counters WHERE family = 'monero'").get() as { next_index: number }).next_index, 2);
closeDb();

console.log("payment tests passed");
