import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../lib/env.ts";
import { hash, passwordOk, randomToken, randomUUID } from "../lib/crypto.ts";
import { addressPoolRows, getInvoice, creditsFor } from "../payments/store.ts";
import { balanceOf, createJsonRpc } from "../payments/chain.ts";
import { resolvePair } from "../payments/allowlist.ts";
import { db } from "../db/client.ts";

const adminUser = process.env.ADMIN_USERNAME?.trim() ?? "";
const adminPasswordHash = process.env.ADMIN_PASSWORD_HASH?.trim() ?? "";
const adminToken = process.env.ADMIN_TOKEN?.trim() ?? "";

const constantTime = (left: string, right: string) => {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};

export const adminRouter = Router();

adminRouter.post("/login", (req, res) => {
  const username = typeof req.body?.username === "string" ? req.body.username.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const valid = Boolean(adminUser && adminPasswordHash && username === adminUser && passwordOk(password, adminPasswordHash));
  if (!valid) return res.status(401).json({ error: "Invalid admin credentials" });
  const token = randomToken();
  const expiresAt = Date.now() + 1000 * 60 * 60 * 8;
  db.prepare("INSERT INTO admin_sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)").run(hash(token), expiresAt, Date.now());
  db.prepare("INSERT INTO admin_audit_events (action, actor, target, detail, created_at) VALUES (?, ?, ?, ?, ?)").run("admin.login", adminUser, null, "Admin session created", Date.now());
  res.cookie("unabridged_admin", token, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/", maxAge: 1000 * 60 * 60 * 8 });
  res.json({ ok: true });
});

adminRouter.post("/logout", (req, res) => {
  const token = req.cookies.unabridged_admin;
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hash(token));
  res.clearCookie("unabridged_admin", { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/" });
  res.json({ ok: true });
});

export const adminAuth = (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  const token = req.cookies.unabridged_admin;
  const session = token ? db.prepare("SELECT expires_at FROM admin_sessions WHERE token_hash = ?").get(hash(token)) as { expires_at: number } | undefined : undefined;
  const configuredToken = adminToken && token && constantTime(token, adminToken);
  if ((session && session.expires_at > Date.now()) || configuredToken) return next();
  if (token) db.prepare("DELETE FROM admin_sessions WHERE token_hash = ?").run(hash(token));
  return res.status(401).json({ error: "Admin sign in required" });
};

adminRouter.get("/overview", adminAuth, (_req, res) => {
  const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;
  const statuses = db.prepare("SELECT status, COUNT(*) AS count FROM payment_invoices GROUP BY status ORDER BY status").all();
  const addressStates = db.prepare("SELECT family, state, COUNT(*) AS count FROM payment_addresses GROUP BY family, state ORDER BY family, state").all();
  const credits = db.prepare("SELECT COUNT(*) AS count FROM payment_credits").get() as { count: number };
  const recentEvents = db.prepare("SELECT id, invoice_id, user_id, at, kind, detail FROM payment_events WHERE kind = 'status' ORDER BY at DESC LIMIT 6").all();
  res.json({
    users: count("SELECT COUNT(*) AS count FROM users"),
    chats: count("SELECT COUNT(*) AS count FROM chats"),
    invoices: count("SELECT COUNT(*) AS count FROM payment_invoices"),
    credits: credits.count,
    proUsers: count("SELECT COUNT(*) AS count FROM users WHERE plan = 'pro' AND pro_expires_at > " + Date.now()),
    activeInvoices: count("SELECT COUNT(*) AS count FROM payment_invoices WHERE status IN ('open', 'underpaid', 'exact_pending')"),
    paidLast7d: count("SELECT COUNT(*) AS count FROM payment_invoices WHERE status = 'succeeded' AND settled_at > " + (Date.now() - 7 * 24 * 60 * 60 * 1000)),
    revenueLast7d: (() => {
      const rows = db.prepare("SELECT chain, asset, expected_base_units FROM payment_invoices WHERE status = 'succeeded' AND settled_at > ?").all(Date.now() - 7 * 24 * 60 * 60 * 1000) as Array<{ chain: string; asset: string; expected_base_units: string }>;
      const usd = rows.filter((row) => row.asset !== "xmr").reduce((total, row) => total + Number(row.expected_base_units) / 1_000_000, 0);
      return { usd: Number.isFinite(usd) ? usd : 0, payments: rows.length };
    })(),
    riskNotices: [
      ...(env.polygonRpcUrls.length === 0 ? ["Polygon RPC is not configured"] : []),
      ...(env.evmAccountXpub.length === 0 ? ["EVM account xpub is not configured"] : []),
      ...(db.prepare("SELECT 1 FROM payment_settings WHERE key = 'pro_price_cents'").get() ? [] : ["Pro price is not configured"]),
    ],
    statuses,
    addressStates,
    prices: db.prepare("SELECT key, value FROM payment_settings ORDER BY key").all(),
    recentEvents,
    chains: {
      ethereum: { rpcConfigured: env.ethereumRpcUrls.length > 0, rpcCount: env.ethereumRpcUrls.length },
      polygon: { rpcConfigured: env.polygonRpcUrls.length > 0, rpcCount: env.polygonRpcUrls.length },
      solana: { rpcConfigured: env.solanaRpcUrls.length > 0, rpcCount: env.solanaRpcUrls.length },
      monero: { rpcConfigured: Boolean(env.moneroWalletRpcUrl), rpcCount: env.moneroWalletRpcUrl ? 1 : 0 },
    },
  });
});

adminRouter.get("/dashboard", adminAuth, (_req, res) => res.redirect("/api/admin/overview"));
adminRouter.get("/payments", adminAuth, (req, res) => {
  const q = typeof req.query.q === "string" ? `%${req.query.q.trim()}%` : "%";
  const status = typeof req.query.status === "string" ? req.query.status : "";
  const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 50) || 50));
  const offset = Math.max(0, Number(req.query.offset ?? 0) || 0);
  const invoices = db.prepare(`SELECT id, user_id, chain, asset, expected_base_units, address, status, created_at, settled_at FROM payment_invoices WHERE (id LIKE ? OR user_id LIKE ? OR address LIKE ?) AND (? = '' OR status = ?) ORDER BY created_at DESC LIMIT ? OFFSET ?`).all(q, q, q, status, status, limit, offset);
  res.json({ invoices, limit, offset });
});
adminRouter.get("/balances", adminAuth, async (_req, res) => {
  const rows = addressPoolRows();
  const pairs = [["ethereum", "usdc"], ["ethereum", "usdt"], ["polygon", "usdc"], ["polygon", "usdt"]] as const;
  const balances = await Promise.all(rows.flatMap((row: any) => {
    if (row.family !== "evm") return [];
    const chains = row.lease_chain ? [row.lease_chain] : ["ethereum", "polygon"];
    return chains.map(async (chain) => {
      const rpcUrl = (chain === "polygon" ? env.polygonRpcUrls : env.ethereumRpcUrls)[0];
      let native = "unavailable";
      if (rpcUrl) {
        try { native = (BigInt(String(await createJsonRpc(rpcUrl)("eth_getBalance", [row.address, "latest"]))) / 1_000_000_000_000_000n).toString(); } catch { /* health is shown separately */ }
      }
      const assets = pairs.filter(([assetChain]) => assetChain === chain).map(async ([, asset]) => {
        const pair = resolvePair(chain, asset);
        if (!pair?.contract || !rpcUrl) return { asset, tokenBalance: "unavailable" };
        try { return { asset, tokenBalance: (await balanceOf(createJsonRpc(rpcUrl), pair.contract, row.address)).toString() }; } catch { return { asset, tokenBalance: "unavailable" }; }
      });
      return { address: row.address, derivationIndex: row.derivation_index, chain, state: row.lease_state ?? row.state, invoiceId: row.lease_invoice_id ?? null, leaseExpiresAt: row.lease_expires_at ?? null, nativeBalanceBaseUnits: native, assets: await Promise.all(assets) };
    });
  }));
  res.json({ addresses: db.prepare("SELECT family, state, COUNT(*) AS count FROM payment_addresses GROUP BY family, state").all(), pool: balances, credits: db.prepare("SELECT chain, COUNT(*) AS count, COALESCE(SUM(CAST(base_units AS INTEGER)), 0) AS baseUnits FROM payment_credits WHERE disappeared_at IS NULL GROUP BY chain").all(), health: db.prepare("SELECT * FROM chain_health ORDER BY chain").all() });
});
adminRouter.get("/withdrawals", adminAuth, (_req, res) => res.json({ sweeps: db.prepare("SELECT id, invoice_id, chain, asset, base_units, from_address, to_address, broadcast_tx, broadcast_at, created_at FROM payment_sweeps ORDER BY created_at DESC LIMIT 200").all(), requests: db.prepare("SELECT * FROM admin_withdrawals ORDER BY created_at DESC LIMIT 200").all() }));
adminRouter.post("/withdrawals", adminAuth, (req, res) => {
  const input = req.body as { chain?: string; asset?: string; toAddress?: string; baseUnits?: string };
  if (!input.chain || !input.asset || !input.toAddress || !/^[0-9]+$/.test(input.baseUnits ?? "")) return res.status(400).json({ error: "Invalid withdrawal request" });
  const id = randomUUID(); const now = Date.now();
  db.prepare("INSERT INTO admin_withdrawals (id, chain, asset, to_address, base_units, status, requested_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'requested', ?, ?, ?)").run(id, input.chain, input.asset, input.toAddress, input.baseUnits, adminUser || "token", now, now);
  db.prepare("INSERT INTO admin_audit_events (action, actor, target, detail, created_at) VALUES (?, ?, ?, ?, ?)").run("withdrawal.requested", adminUser || "token", id, JSON.stringify(input), now);
  res.status(201).json({ id, status: "requested" });
});
adminRouter.post("/withdrawals/:id/approve", adminAuth, (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : ""; const now = Date.now();
  const result = db.prepare("UPDATE admin_withdrawals SET status = 'approved', approved_by = ?, updated_at = ? WHERE id = ? AND status = 'requested'").run(adminUser || "token", now, id);
  if (!result.changes) return res.status(409).json({ error: "Withdrawal is not awaiting approval" });
  db.prepare("INSERT INTO admin_audit_events (action, actor, target, detail, created_at) VALUES (?, ?, ?, ?, ?)").run("withdrawal.approved", adminUser || "token", id, "Approved; signer execution remains disabled", now);
  res.json({ id, status: "approved" });
});
adminRouter.get("/analytics", adminAuth, (_req, res) => res.json({ byChain: db.prepare("SELECT chain, COUNT(*) AS invoices, SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS paid FROM payment_invoices GROUP BY chain").all(), byAsset: db.prepare("SELECT asset, COUNT(*) AS invoices, SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS paid FROM payment_invoices GROUP BY asset").all() }));
adminRouter.get("/webhooks", adminAuth, (_req, res) => res.json({ endpoints: db.prepare("SELECT id, url, created_at FROM payment_webhook_endpoints").all(), deliveries: db.prepare("SELECT id, invoice_id, event, created_at, next_attempt_at, delivered_at FROM payment_webhook_deliveries ORDER BY created_at DESC LIMIT 200").all() }));
adminRouter.get("/settings", adminAuth, (_req, res) => res.json({ prices: db.prepare("SELECT key, value FROM payment_settings ORDER BY key").all(), chains: { ethereum: env.ethereumRpcUrls.length, polygon: env.polygonRpcUrls.length, solana: env.solanaRpcUrls.length, monero: env.moneroWalletRpcUrl ? 1 : 0 } }));
adminRouter.put("/settings/pricing", adminAuth, (req, res) => {
  const raw = typeof req.body?.proPriceUsd === "string" ? req.body.proPriceUsd.trim() : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return res.status(400).json({ error: "Enter a valid USD price with up to two decimal places." });
  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000_000) return res.status(400).json({ error: "Price must be between $0.01 and $100,000.00." });
  const now = Date.now();
  const previous = (db.prepare("SELECT value FROM payment_settings WHERE key = ?").get("pro_price_cents") as { value: string } | undefined)?.value ?? null;
  db.transaction(() => {
    db.prepare("INSERT INTO payment_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run("pro_price_cents", String(cents));
    db.prepare("INSERT INTO admin_audit_events (action, actor, target, detail, created_at) VALUES (?, ?, ?, ?, ?)").run("pricing.updated", adminUser || "token", "pro_price_cents", JSON.stringify({ previous, next: String(cents) }), now);
  })();
  res.json({ key: "pro_price_cents", cents, usd: (cents / 100).toFixed(2) });
});
adminRouter.get("/audit", adminAuth, (_req, res) => res.json({ events: db.prepare("SELECT * FROM admin_audit_events ORDER BY created_at DESC LIMIT 300").all() }));
adminRouter.get("/unmatched", adminAuth, (_req, res) => res.json({ transfers: db.prepare("SELECT * FROM unmatched_transfers WHERE status = 'unreviewed' ORDER BY first_seen_at DESC LIMIT 200").all() }));
adminRouter.get("/audit", adminAuth, (_req, res) => res.json({ events: db.prepare("SELECT * FROM admin_audit_events ORDER BY created_at DESC LIMIT 300").all() }));
adminRouter.get("/unmatched", adminAuth, (_req, res) => res.json({ transfers: db.prepare("SELECT * FROM unmatched_transfers WHERE status = 'unreviewed' ORDER BY first_seen_at DESC LIMIT 200").all() }));

adminRouter.get("/invoices/:id", adminAuth, (req, res) => {
  const invoiceId = typeof req.params.id === "string" ? req.params.id : "";
  const invoice = getInvoice(invoiceId);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json({ invoice, credits: creditsFor(invoice.id) });
});
