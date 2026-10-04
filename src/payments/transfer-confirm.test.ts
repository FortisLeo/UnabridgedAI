import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "uai-transfer-")), "test.db");
process.env.PAYMENT_WATCH_MS = "0";
const cold = "0x2222222222222222222222222222222222222222";
const token = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
let includeLog = false;
const rpc = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { method: string };
    const log = {
      address: token,
      topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", "0x" + "11".repeat(32), "0x" + cold.slice(2).padStart(64, "0")],
      data: "0x" + (10_000).toString(16).padStart(64, "0"),
      logIndex: "0x0",
      blockNumber: "0x10",
      blockHash: "0x" + "ab".repeat(32),
      transactionHash: "0x" + "cd".repeat(32),
    };
    const result = body.method === "eth_getTransactionReceipt"
      ? (includeLog ? { status: "0x1", blockHash: log.blockHash, blockNumber: "0x10", logs: [log] } : null)
      : "0x89";
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  });
});
rpc.listen(0, "127.0.0.1");
await once(rpc, "listening");
const address = rpc.address();
if (!address || typeof address === "string") throw new Error("no port");
process.env.POLYGON_RPC_URLS = `http://127.0.0.1:${address.port}`;
process.env.POLYGON_COLD_ADDRESS = cold;

const { db, closeDb } = await import("../db/client.ts");
const { confirmTransfer, TransferError } = await import("./transfers.ts");
db.exec(`CREATE TABLE IF NOT EXISTS payment_transfers (
  id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, chain TEXT NOT NULL, status TEXT NOT NULL, to_address TEXT NOT NULL,
  base_units TEXT NOT NULL, unsigned_tx TEXT, tx_hash TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
)`);
db.exec("INSERT INTO payment_addresses (address, family, derivation_index, ata, state, created_at) VALUES ('0x1111111111111111111111111111111111111111', 'evm', 9, NULL, 'assigned', 1)");
db.prepare("INSERT INTO users (id, username, password_hash, plan, created_at) VALUES ('payer', 'payer', 'x', 'pro', 1)").run();
db.prepare("INSERT INTO payment_invoices (id, user_id, chain, asset, token_contract, expected_base_units, address, derivation_index, status, qr_expires_at, created_at, updated_at, grant_applied_at) VALUES ('paid', 'payer', 'polygon', 'usdc', ?, '10000', '0x1111111111111111111111111111111111111111', 9, 'succeeded', 2, 1, 1, 1)").run(token);
db.prepare("INSERT INTO payment_address_leases (address, chain, invoice_id, state, leased_at, expires_at) VALUES ('0x1111111111111111111111111111111111111111', 'polygon', 'paid', 'paid_pending_sweep', 1, 2)").run();
db.prepare("INSERT INTO payment_transfers (id, invoice_id, chain, status, to_address, base_units, tx_hash, created_at, updated_at) VALUES ('transfer-1', 'paid', 'polygon', 'broadcast', ?, '10000', '0xabc', 1, 1)").run(cold);

await assert.rejects(() => confirmTransfer("transfer-1", 2), (error: unknown) => error instanceof TransferError && error.code === "confirmation_pending");
includeLog = true;
const confirmed = await confirmTransfer("transfer-1", 3);
assert.equal(confirmed.status, "confirmed");
assert.equal((db.prepare("SELECT state FROM payment_addresses WHERE derivation_index = 9").get() as { state: string }).state, "swept");
assert.equal((db.prepare("SELECT state FROM payment_address_leases WHERE invoice_id = 'paid'").get() as { state: string }).state, "swept");
const { availableEvmIndex } = await import("./store.ts");
assert.equal(availableEvmIndex("polygon", 60_000), 9);
await new Promise<void>((resolve) => rpc.close(() => resolve()));
closeDb();
console.log("transfer confirmation test passed");
