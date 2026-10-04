import { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { env } from "../lib/env.ts";
import { hash, passwordOk, randomToken, randomUUID } from "../lib/crypto.ts";
import { addressPoolRows, getInvoice, creditsFor } from "../payments/store.ts";
import { balanceOf, createJsonRpc } from "../payments/chain.ts";
import { resolvePair } from "../payments/allowlist.ts";
import { db } from "../db/client.ts";
import { adminOverviewRows, approveWithdrawal, createAdminSession, createWithdrawalRequest, deleteAdminSession, findAdminSession, listAuditEvents, listPaymentPrices, listWithdrawalRequests, setPaymentPrice } from "../repositories/admin.ts";
import { count } from "../repositories/admin-reports.ts";
import { balancesSummary, paymentSearch, revenueRows, sweepRows, unmatchedRows, webhookRows } from "../repositories/admin-reports.ts";

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
  createAdminSession(hash(token), expiresAt, adminUser);
  res.cookie("unabridged_admin", token, { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/", maxAge: 1000 * 60 * 60 * 8 });
  res.json({ ok: true });
});

adminRouter.post("/logout", (req, res) => {
  const token = req.cookies.unabridged_admin;
  if (token) deleteAdminSession(hash(token));
  res.clearCookie("unabridged_admin", { httpOnly: true, sameSite: "strict", secure: req.secure, path: "/" });
  res.json({ ok: true });
});

export const adminAuth = (req: import("express").Request, res: import("express").Response, next: import("express").NextFunction) => {
  const token = req.cookies.unabridged_admin;
  const session = token ? findAdminSession(hash(token)) : undefined;
  const configuredToken = adminToken && token && constantTime(token, adminToken);
  if ((session && session.expires_at > Date.now()) || configuredToken) return next();
  if (token) deleteAdminSession(hash(token));
  return res.status(401).json({ error: "Admin sign in required" });
};

adminRouter.get("/overview", adminAuth, (_req, res) => {
  const count = (sql: string) => (db.prepare(sql).get() as { count: number }).count;
  const { statuses, addressStates, credits, recentEvents } = adminOverviewRows();
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
      ...(listPaymentPrices().some((price) => price.key === "pro_price_cents") ? [] : ["Pro price is not configured"]),
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
  const invoices = paymentSearch(typeof req.query.q === "string" ? req.query.q : "", status, limit, offset);
  res.json({ invoices, limit, offset });
});
adminRouter.get("/balances", adminAuth, async (_req, res) => {
  try {
    const rows = addressPoolRows();
    const pairs = [["ethereum", "usdc"], ["ethereum", "usdt"], ["polygon", "usdc"], ["polygon", "usdt"]] as const;
    const jobs = rows.flatMap((row: any) => {
      if (row.family !== "evm") return [];
      const chains = row.lease_chain ? [row.lease_chain] : ["ethereum", "polygon"];
      return chains.map(async (chain) => {
        const rpcUrl = (chain === "polygon" ? env.polygonRpcUrls : env.ethereumRpcUrls)[0];
        let native = "unavailable";
        if (rpcUrl) {
          try {
            const value = await createJsonRpc(rpcUrl)("eth_getBalance", [row.address, "latest"]);
            native = (BigInt(String(value)) / 1_000_000_000_000_000n).toString();
          } catch { /* show unavailable for this address */ }
        }
        const assets = await Promise.all(pairs.filter(([assetChain]) => assetChain === chain).map(async ([, asset]) => {
          const pair = resolvePair(chain, asset);
          if (!pair?.contract || !rpcUrl) return { asset, tokenBalance: "unavailable" };
          try { return { asset, tokenBalance: (await balanceOf(createJsonRpc(rpcUrl), pair.contract, row.address)).toString() }; }
          catch { return { asset, tokenBalance: "unavailable" }; }
        }));
        return { address: row.address, derivationIndex: row.derivation_index, chain, state: row.lease_state ?? row.state, invoiceId: row.lease_invoice_id ?? null, leaseExpiresAt: row.lease_expires_at ?? null, nativeBalanceBaseUnits: native, assets };
      });
    });
    const settled = await Promise.allSettled(jobs);
    const balances = settled.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    res.json({ addresses: db.prepare("SELECT family, state, COUNT(*) AS count FROM payment_addresses GROUP BY family, state").all(), pool: balances, credits: db.prepare("SELECT chain, COUNT(*) AS count, COALESCE(SUM(CAST(base_units AS INTEGER)), 0) AS baseUnits FROM payment_credits WHERE disappeared_at IS NULL GROUP BY chain").all(), health: db.prepare("SELECT * FROM chain_health ORDER BY chain").all() });
  } catch (error) {
    console.error("admin balances failed", error);
    res.status(200).json({ addresses: [], pool: [], credits: [], health: [], error: "Address balance data is temporarily unavailable." });
  }
});
adminRouter.get("/withdrawals", adminAuth, (_req, res) => res.json({ sweeps: sweepRows(), requests: listWithdrawalRequests() }));
adminRouter.post("/withdrawals", adminAuth, (req, res) => {
  const input = req.body as { chain?: string; asset?: string; toAddress?: string; baseUnits?: string };
  if (!input.chain || !input.asset || !input.toAddress || !/^[0-9]+$/.test(input.baseUnits ?? "")) return res.status(400).json({ error: "Invalid withdrawal request" });
  const chain = input.chain; const asset = input.asset; const toAddress = input.toAddress; const baseUnits = input.baseUnits as string;
  const id = randomUUID(); const now = Date.now();
  createWithdrawalRequest({ id, chain, asset, toAddress, baseUnits, actor: adminUser || "token", now });
  res.status(201).json({ id, status: "requested" });
});
adminRouter.post("/withdrawals/:id/approve", adminAuth, (req, res) => {
  const id = typeof req.params.id === "string" ? req.params.id : ""; const now = Date.now();
  const result = db.prepare("UPDATE admin_withdrawals SET status = 'approved', approved_by = ?, updated_at = ? WHERE id = ? AND status = 'requested'").run(adminUser || "token", now, id);
  if (!result.changes) return res.status(409).json({ error: "Withdrawal is not awaiting approval" });
  db.prepare("INSERT INTO admin_audit_events (action, actor, target, detail, created_at) VALUES (?, ?, ?, ?, ?)").run("withdrawal.approved", adminUser || "token", id, "Approved; signer execution remains disabled", now);
  res.json({ id, status: "approved" });
});
adminRouter.get("/analytics", adminAuth, (_req, res) => res.json(revenueRows()));
adminRouter.get("/webhooks", adminAuth, (_req, res) => res.json(webhookRows()));
adminRouter.get("/settings", adminAuth, (_req, res) => res.json({ prices: listPaymentPrices(), chains: { ethereum: env.ethereumRpcUrls.length, polygon: env.polygonRpcUrls.length, solana: env.solanaRpcUrls.length, monero: env.moneroWalletRpcUrl ? 1 : 0 } }));
adminRouter.put("/settings/pricing", adminAuth, (req, res) => {
  const raw = typeof req.body?.proPriceUsd === "string" ? req.body.proPriceUsd.trim() : "";
  if (!/^\d+(?:\.\d{1,2})?$/.test(raw)) return res.status(400).json({ error: "Enter a valid USD price with up to two decimal places." });
  const [whole, fraction = ""] = raw.split(".");
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents <= 0 || cents > 10_000_000) return res.status(400).json({ error: "Price must be between $0.01 and $100,000.00." });
  const now = Date.now();
  const { previous } = setPaymentPrice("pro_price_cents", String(cents), adminUser || "token", now);
  res.json({ key: "pro_price_cents", cents, usd: (cents / 100).toFixed(2) });
});
adminRouter.get("/audit", adminAuth, (_req, res) => res.json({ events: listAuditEvents() }));
adminRouter.get("/unmatched", adminAuth, (_req, res) => res.json({ transfers: unmatchedRows() }));

adminRouter.get("/invoices/:id", adminAuth, (req, res) => {
  const invoiceId = typeof req.params.id === "string" ? req.params.id : "";
  const invoice = getInvoice(invoiceId);
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json({ invoice, credits: creditsFor(invoice.id) });
});
