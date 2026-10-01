import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";

const directory = mkdtempSync(join(tmpdir(), "uai-morlane-"));
process.env.DB_PATH = join(directory, "test.db");
process.env.PAYMENT_WATCH_MS = "0";
process.env.PAYMENT_WEBHOOK_SECRET = "endpoint-secret";
process.env.EVM_ACCOUNT_XPUB = "xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5";

const received: Array<{ signature: string; timestamp: string; body: string }> = [];
const hook = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  req.on("end", () => {
    received.push({ signature: String(req.headers["x-payment-signature"] ?? ""), timestamp: String(req.headers["x-payment-timestamp"] ?? ""), body: Buffer.concat(chunks).toString("utf8") });
    res.writeHead(req.headers["x-fail"] ? 500 : 200).end("ok");
  });
});
hook.listen(0, "127.0.0.1");
await once(hook, "listening");
const hookAddress = hook.address();
if (!hookAddress || typeof hookAddress === "string") throw new Error("no port");
process.env.PAYMENT_WEBHOOK_URL = `http://127.0.0.1:${hookAddress.port}/hook`;

const { signWebhook, WEBHOOK_RETRY_MS } = await import("./webhooks.ts");
const { createApp, errorHandler } = await import("../app.ts");
const { db, closeDb } = await import("../db/client.ts");
const { setPrice } = await import("./store.ts");
const { deliverDueWebhooks, enqueuePaymentWebhook } = await import("./webhooks.ts");
setPrice("pro_price_cents", "1500");
const app = createApp();
app.use(errorHandler);
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
const address = server.address();
if (!address || typeof address === "string") throw new Error("no port");
const base = `http://127.0.0.1:${address.port}/api`;

const signup = await fetch(`${base}/auth/signup`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ username: "checkout_user", password: "checkout-test-password" }),
});
assert.equal(signup.status, 200);
const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).find((value) => value.startsWith("unabridged_session="));
assert.ok(cookie);

const created = await fetch(`${base}/billing/invoices`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ chain: "ethereum", asset: "usdc" }),
});
const checkout = await created.json();
assert.equal(created.status, 201);
assert.equal(checkout.asset, "usdc");
assert.equal(checkout.chain, "ethereum");
assert.equal(checkout.expectedBaseUnits, "15000000");
assert.match(checkout.address, /^0x[0-9a-fA-F]{40}$/);
assert.equal(checkout.qrExpiresAt - checkout.createdAt, 60 * 60 * 1000);

const second = await fetch(`${base}/billing/invoices`, {
  method: "POST",
  headers: { "content-type": "application/json", cookie },
  body: JSON.stringify({ chain: "polygon", asset: "usdc" }),
});
assert.equal(second.status, 409);
const blocked = await second.json();
assert.equal(blocked.invoiceId, checkout.id);
assert.equal(blocked.address, undefined);

const deliveryId = enqueuePaymentWebhook(checkout.id, "payment.status");
assert.ok(deliveryId);
const before = db.prepare("SELECT plan FROM users WHERE username = 'checkout_user'").get() as { plan: string };
const now = Date.now();
await deliverDueWebhooks(now);
assert.equal(received.length, 1);
assert.equal(received[0]?.signature, signWebhook("endpoint-secret", received[0]?.body ?? "", now));
const after = db.prepare("SELECT plan FROM users WHERE username = 'checkout_user'").get() as { plan: string };
assert.equal(after.plan, before.plan);
assert.equal(after.plan, "free");

const forged = await fetch(`${base}/billing/webhooks/payment`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-payment-timestamp": "1000", "x-payment-signature": "ab".repeat(32) },
  body: JSON.stringify({ invoiceId: checkout.id, status: "succeeded" }),
});
assert.equal(forged.status, 401);
assert.equal((db.prepare("SELECT plan FROM users WHERE username = 'checkout_user'").get() as { plan: string }).plan, "free");

const body = JSON.stringify({ invoiceId: checkout.id, status: "succeeded" });
const signedAt = Date.now();
const signed = await fetch(`${base}/billing/webhooks/payment`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-payment-timestamp": String(signedAt),
    "x-payment-signature": signWebhook("endpoint-secret", body, signedAt),
  },
  body,
});
assert.equal(signed.status, 200);
assert.equal((await signed.json()).granted, false);
assert.equal((db.prepare("SELECT plan FROM users WHERE username = 'checkout_user'").get() as { plan: string }).plan, "free");

db.prepare("UPDATE payment_webhook_deliveries SET delivered_at = NULL, next_attempt_at = ? WHERE id = ?").run(1_000, deliveryId);
await deliverDueWebhooks(1_000 + WEBHOOK_RETRY_MS);
const attempts = db.prepare("SELECT COUNT(*) AS count FROM payment_webhook_attempts WHERE delivery_id = ?").get(deliveryId) as { count: number };
assert.equal(attempts.count, 2);
const delivered = db.prepare("SELECT delivered_at FROM payment_webhook_deliveries WHERE id = ?").get(deliveryId) as { delivered_at: number | null };
assert.ok(delivered.delivered_at);

await new Promise<void>((resolve) => server.close(() => resolve()));
await new Promise<void>((resolve) => hook.close(() => resolve()));
closeDb();
rmSync(directory, { recursive: true, force: true });
console.log("local checkout and webhook tests passed");
