import { Router } from "express";
import { z } from "zod";
import { getUserUsage, quotaFor } from "../repositories/usage.ts";
import { userIdOf } from "../types.ts";
import { auth } from "../middleware/auth.ts";
import { invoiceCreateGuard } from "../middleware/security.ts";
import { resolvePair } from "../payments/allowlist.ts";
import { createInvoice, InvoiceError, readInvoice, submitRefundAddress } from "../payments/invoices.ts";

export const billingRouter = Router();

billingRouter.get("/", auth, (req, res) => {
  const user = getUserUsage(userIdOf(req));
  if (!user) return res.status(401).json({ error: "Sign in required" });
  res.json({ quota: quotaFor(user) });
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
