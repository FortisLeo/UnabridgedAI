import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { once } from "node:events";

const directory = mkdtempSync(join(process.cwd(), ".invoice-api-"));
process.env.DB_PATH = join(directory, "test.db");
process.env.PAYMENT_WATCH_MS = "0";
process.env.EVM_ACCOUNT_XPUB = "xpub6D4BDPcP2GT577Vvch3R8wDkScZWzQzMMUm3PWbmWvVJrZwQY4VUNgqFJPMM3No2dFDFGTsxxpG5uJh7n7epu4trkrX7x7DogT5Uv6fcLW5";

const { createApp, errorHandler } = await import("../app.ts");
const { closeDb } = await import("../db/client.ts");
const { setPrice } = await import("./store.ts");
setPrice("pro_price_cents", "1500");
const app = createApp();
app.use(errorHandler);
const server = app.listen(0, "127.0.0.1");
try {
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}/api`;
  const signup = await fetch(`${base}/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "invoice_test", password: "invoice-test-password" }),
  });
  assert.equal(signup.status, 200);
  await signup.json();
  const cookie = signup.headers.getSetCookie().map((value) => value.split(";")[0]).find((value) => value.startsWith("unabridged_session="));
  assert.ok(cookie);
  const created = await fetch(`${base}/billing/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ chain: "ethereum", asset: "usdc" }),
  });
  const invoice = await created.json();
  assert.equal(created.status, 201, JSON.stringify(invoice));
  assert.equal(invoice.chain, "ethereum");
  assert.equal(invoice.asset, "usdc");
  assert.match(invoice.address, /^0x[0-9a-fA-F]{40}$/);
  assert.equal(invoice.expectedBaseUnits, "15000000");
  assert.equal(invoice.displayAmount, "15.000000");
  assert.equal(invoice.status, "open");
  const polled = await fetch(`${base}/billing/invoices/${invoice.id}`, { headers: { Cookie: cookie } });
  assert.equal(polled.status, 200);
  assert.deepEqual(await polled.json(), invoice);
  const blocked = await fetch(`${base}/billing/invoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ chain: "polygon", asset: "usdc" }),
  });
  const blockedBody = await blocked.json();
  assert.equal(blocked.status, 409);
  assert.equal(blockedBody.invoiceId, invoice.id);
  const billing = await fetch(`${base}/billing`, { headers: { Cookie: cookie } });
  const billingBody = await billing.json();
  assert.equal(billing.status, 200);
  assert.equal(billingBody.invoice?.id, invoice.id);
  assert.equal(billingBody.invoice?.address, invoice.address);
  console.log("authenticated Ethereum USDC invoice creation and polling passed");
} finally {
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  closeDb();
  rmSync(directory, { recursive: true, force: true });
}
