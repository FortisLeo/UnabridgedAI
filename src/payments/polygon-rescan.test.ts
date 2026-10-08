import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const directory = mkdtempSync(join(tmpdir(), "uai-polygon-"));
process.env.DB_PATH = join(directory, "test.db");
process.env.PAYMENT_WATCH_MS = "0";
process.env.EVM_ACCOUNT_XPUB = "xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5";

const transferBlock = 94_600_389;
const cursorBlock = 94_600_555;
let headBlock = 94_600_560;
const freshCursor = 94_590_000;
const freshHead = 94_600_560;
const freshTransfer = 94_600_540;
const txHash = "0x70af819856448c3404ce65a06a7556127ff1194fac853c20fbedc10b6645d85d";
const blockHash = "0xabc0000000000000000000000000000000000000000000000000000000000001";
const deposit = "0x3997Ee8610C49c1dABacC865A9dC2A9fbB37Ba70";
const contract = "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359";
const amount = 10_000n;

const readBody = (req: IncomingMessage) =>
  new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });

const hex = (value: number | bigint) => `0x${value.toString(16)}`;

const oneLog = (hash: string, block: number) => ({
  transactionHash: hash,
  logIndex: "0x0",
  blockNumber: hex(block),
  blockHash,
  address: contract,
  topics: [
    "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
    "0x" + "11".repeat(32),
    "0x" + deposit.slice(2).padStart(64, "0"),
  ],
  data: hex(amount),
  removed: false,
});

let phase: "behind" | "head" = "behind";
const transferLog = (fromBlock: number, toBlock: number) => {
  const block = phase === "behind" ? transferBlock : freshTransfer;
  const hash = phase === "behind" ? txHash : `${txHash.slice(0, -1)}e`;
  return fromBlock <= block && toBlock >= block ? [oneLog(hash, block)] : [];
};

const serve = (fail: boolean) => async (req: IncomingMessage, res: ServerResponse) => {
  const body = JSON.parse(await readBody(req)) as { method: string; params: unknown[] };
  const send = (result: unknown) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));
  };
  const reject = () => {
    res.writeHead(429, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { message: "rate limited" } }));
  };
  if (body.method === "eth_chainId") return send(hex(137));
  if (body.method === "eth_getBlockByNumber") {
    const requested = body.params[0] === "finalized" ? headBlock : Number(BigInt(String(body.params[0])));
    return send({ number: hex(requested), hash: blockHash });
  }
  if (body.method === "eth_getLogs") {
    const filter = body.params[0] as { fromBlock: string; toBlock: string };
    const fromBlock = Number(BigInt(filter.fromBlock));
    const toBlock = Number(BigInt(filter.toBlock));
    return send(transferLog(fromBlock, toBlock));
  }
  if (fail && (body.method === "eth_getTransactionReceipt" || body.method === "eth_call")) return reject();
  if (body.method === "eth_getTransactionReceipt") return send({ status: "0x1", blockHash, logs: [] });
  if (body.method === "eth_call") return send(hex(amount * 200n));
  res.writeHead(400).end();
};

const listen = async (handler: (req: IncomingMessage, res: ServerResponse) => Promise<void>) => {
  const server = createServer((req, res) => {
    void handler(req, res);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  return { server, url: `http://127.0.0.1:${address.port}` };
};

const healthy = await listen(serve(false));
const failing = await listen(serve(true));
process.env.POLYGON_RPC_URLS = `${healthy.url},${failing.url}`;

const { db, closeDb } = await import("../db/client.ts");
const { watchOnceForTests } = await import("./watch.ts");

db.prepare("INSERT INTO users (id, username, password_hash, plan, created_at) VALUES ('payer', 'payer', 'x', 'free', 1)").run();
db.prepare("INSERT INTO payment_addresses (address, family, derivation_index, ata, state, created_at) VALUES (?, 'evm', 4, NULL, 'assigned', 1)").run(deposit);
db.prepare(
  `INSERT INTO payment_invoices (
    id, user_id, chain, asset, token_contract, expected_base_units, address, derivation_index, status,
    qr_expires_at, created_at, updated_at
  ) VALUES ('5a1026c7-b1bd-48c1-a1e1-a1289eb88bc6', 'payer', 'polygon', 'usdc', ?, '10000', ?, 4, 'open', ?, 1, 1)`,
).run(contract, deposit, Date.now() + 60_000);
db.prepare(
  `INSERT INTO payment_credits (
    id, invoice_id, chain, tx_hash, output_index, base_units, height, block_hash, confirmations,
    locked, wrong_asset, settled, first_seen_at, credit_key
  ) VALUES ('credit-1', '5a1026c7-b1bd-48c1-a1e1-a1289eb88bc6', 'polygon', ?, 0, '10000', ?, ?, 0, 0, 0, 0, ?, ?)`,
).run(txHash, transferBlock, blockHash, Date.now() - 1_000, `polygon:${txHash}:0:`);
db.prepare("INSERT INTO payment_cursors (chain, height, block_hash, updated_at) VALUES ('polygon', ?, ?, 1)").run(cursorBlock, blockHash);

await watchOnceForTests();

const invoice = db.prepare("SELECT status, grant_applied_at FROM payment_invoices WHERE id = '5a1026c7-b1bd-48c1-a1e1-a1289eb88bc6'").get() as {
  status: string;
  grant_applied_at: number | null;
};
const credit = db.prepare("SELECT settled FROM payment_credits WHERE id = 'credit-1'").get() as { settled: number };
const user = db.prepare("SELECT plan FROM users WHERE id = 'payer'").get() as { plan: string };
assert.equal(credit.settled, 1);
assert.equal(invoice.status, "succeeded");
assert.ok(invoice.grant_applied_at);
assert.equal(user.plan, "pro");
assert.ok((cursorBlock - transferBlock) > 42);

phase = "head";
db.prepare("DELETE FROM payment_credits").run();
db.prepare("UPDATE payment_invoices SET status = 'open', grant_applied_at = NULL, settled_at = NULL WHERE id = '5a1026c7-b1bd-48c1-a1e1-a1289eb88bc6'").run();
db.prepare("UPDATE users SET plan = 'free' WHERE id = 'payer'").run();
db.prepare("UPDATE payment_cursors SET height = ? WHERE chain = 'polygon'").run(freshCursor);
headBlock = freshHead;
await watchOnceForTests();
const freshCredit = db.prepare("SELECT settled, height FROM payment_credits WHERE invoice_id = '5a1026c7-b1bd-48c1-a1e1-a1289eb88bc6'").get() as { settled: number; height: number } | undefined;
const cursor = db.prepare("SELECT height FROM payment_cursors WHERE chain = 'polygon'").get() as { height: number };
assert.equal(freshCredit?.height, freshTransfer);
assert.equal(freshCredit?.settled, 1);
assert.ok(freshHead - freshCursor > 10_000);
assert.equal(cursor.height, freshHead);

healthy.server.close();
failing.server.close();
closeDb();
console.log("polygon rescan regression passed");
