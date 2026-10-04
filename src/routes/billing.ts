import { createHmac } from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { getUserUsage, quotaFor } from "../repositories/usage.ts";
import { userIdOf } from "../types.ts";
import { auth } from "../middleware/auth.ts";
import { invoiceCreateGuard } from "../middleware/security.ts";
import { resolvePair } from "../payments/allowlist.ts";
import { createInvoice, InvoiceError, paymentHistory, readInvoice, resumeInvoice, submitRefundAddress } from "../payments/invoices.ts";
import { acceptWebhookHint, webhookSignatureValid } from "../payments/webhooks.ts";
import { broadcastTransfer, confirmTransfer, prepareTransferGas, TransferError } from "../payments/transfers.ts";
import { db } from "../db/client.ts";

export const billingRouter = Router();

billingRouter.get("/", auth, (req, res) => {
  const user = getUserUsage(userIdOf(req));
  if (!user) return res.status(401).json({ error: "Sign in required" });
  const userId = userIdOf(req);
  res.json({ quota: quotaFor(user), proExpiresAt: quotaFor(user).proExpiresAt, invoice: resumeInvoice(userId), payments: paymentHistory(userId) });
});

billingRouter.post("/invoices", auth, invoiceCreateGuard, async (req, res) => {
  const parsed = z.object({ chain: z.string(), asset: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid invoice request" });
  const pair = resolvePair(parsed.data.chain, parsed.data.asset);
  if (!pair) return res.status(400).json({ error: "That asset is not accepted on that chain." });
  try {
    const invoice = await createInvoice(userIdOf(req), pair);
    return res.status(201).json(invoice);
  } catch (error) {
    if (error instanceof InvoiceError) return res.status(error.status).json({ error: error.message, ...error.extra });
    return res.status(503).json({ error: "Payments are not available." });
  }
});

billingRouter.get("/invoices/:id", auth, (req, res) => {
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const invoice = readInvoice(userIdOf(req), id ?? "");
  if (!invoice) return res.status(404).json({ error: "Invoice not found" });
  res.json(invoice);
});

billingRouter.post("/webhooks/payment", (req, res) => {
  const raw = JSON.stringify(req.body ?? {});
  const timestamp = String(req.header("x-payment-timestamp") ?? "");
  const signature = String(req.header("x-payment-signature") ?? "");
  const endpoint = db.prepare("SELECT secret FROM payment_webhook_endpoints WHERE url = ?").get(process.env.PAYMENT_WEBHOOK_URL?.trim() ?? "") as { secret: string } | undefined;
  const secret = process.env.PAYMENT_WEBHOOK_SECRET?.trim() ?? "";
  const matchesStored = endpoint && (endpoint.secret === secret || endpoint.secret === `sha256:${createHmac("sha256", "payment-webhook").update(secret).digest("hex")}`);
  if (!matchesStored || !webhookSignatureValid(secret, raw, timestamp, signature)) {
    return res.status(401).json({ error: "Invalid webhook signature" });
  }
  const hint = acceptWebhookHint(raw);
  return res.json(hint);
});

billingRouter.post("/transfers/:chain/gas", auth, async (req, res) => {
  const chain = req.params.chain;
  if (chain !== "polygon" && chain !== "ethereum") return res.status(400).json({ error: "That chain is not supported." });
  try {
    return res.json({ transfers: await prepareTransferGas(chain) });
  } catch (error) {
    if (error instanceof TransferError) return res.status(409).json({ error: error.message, code: error.code });
    return res.status(503).json({ error: "Payments are not available." });
  }
});

billingRouter.post("/transfers/:id/broadcast", auth, async (req, res) => {
  try {
    return res.json(await broadcastTransfer(String(req.params.id)));
  } catch (error) {
    if (error instanceof TransferError) return res.status(409).json({ error: error.message, code: error.code });
    return res.status(503).json({ error: "Payments are not available." });
  }
});

billingRouter.post("/transfers/:id/confirm", auth, async (req, res) => {
  try {
    return res.json(await confirmTransfer(String(req.params.id)));
  } catch (error) {
    if (error instanceof TransferError) return res.status(409).json({ error: error.message, code: error.code });
    return res.status(503).json({ error: "Payments are not available." });
  }
});

billingRouter.post("/invoices/:id/refund-address", auth, (req, res) => {
  const parsed = z.object({ address: z.string().min(20).max(200), refundChain: z.string() }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid refund address" });
  const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  try {
    const invoice = submitRefundAddress(userIdOf(req), id ?? "", parsed.data.address, parsed.data.refundChain);
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });
    return res.json(invoice);
  } catch (error) {
    if (error instanceof InvoiceError) return res.status(error.status).json({ error: error.message });
    return res.status(400).json({ error: "Invalid refund address" });
  }
});
