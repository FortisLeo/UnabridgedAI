import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "../db/client.ts";
import { env } from "../lib/env.ts";
import { randomUUID } from "../lib/crypto.ts";
import { getInvoice } from "./store.ts";

export const WEBHOOK_RETRY_MS = 10 * 60 * 1000;

export const signWebhook = (secret: string, body: string, timestamp: number) =>
  createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");

export const webhookSignatureValid = (secret: string, body: string, timestamp: string, signature: string) => {
  if (!/^[0-9]+$/.test(timestamp) || !/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = signWebhook(secret, body, Number(timestamp));
  const left = Buffer.from(expected);
  const right = Buffer.from(signature);
  return left.length === right.length && timingSafeEqual(left, right);
};

const webhookConfig = () => ({
  url: process.env.PAYMENT_WEBHOOK_URL?.trim() || env.paymentWebhookUrl,
  secret: process.env.PAYMENT_WEBHOOK_SECRET?.trim() || env.paymentWebhookSecret,
});

const ensureEndpoint = (now: number) => {
  const configured = webhookConfig();
  if (!configured.url || !configured.secret) return null;
  const existing = db.prepare("SELECT id, secret FROM payment_webhook_endpoints WHERE url = ?").get(configured.url) as { id: string; secret: string } | undefined;
  if (existing) {
    if (existing.secret !== configured.secret) {
      db.prepare("UPDATE payment_webhook_endpoints SET secret = ? WHERE id = ?").run(configured.secret, existing.id);
    }
    return existing.id;
  }
  const id = randomUUID();
  db.prepare("INSERT INTO payment_webhook_endpoints (id, url, secret, created_at) VALUES (?, ?, ?, ?)").run(id, configured.url, configured.secret, now);
  return id;
};

export const enqueuePaymentWebhook = (invoiceId: string, event: string, now = Date.now()) => {
  const endpointId = ensureEndpoint(now);
  if (!endpointId) return null;
  const invoice = getInvoice(invoiceId);
  if (!invoice) return null;
  const id = randomUUID();
  const body = JSON.stringify({
    id,
    event,
    invoiceId: invoice.id,
    status: invoice.status,
    chain: invoice.chain,
    asset: invoice.asset,
    address: invoice.address,
    expectedBaseUnits: invoice.expected_base_units,
    hint: true,
  });
  db.prepare(
    "INSERT INTO payment_webhook_deliveries (id, endpoint_id, invoice_id, event, body, created_at, next_attempt_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, endpointId, invoiceId, event, body, now, now);
  return id;
};

export type WebhookDelivery = { id: string; url: string; secret: string; body: string };

export const dueWebhookDeliveries = (now = Date.now()) =>
  db
    .prepare(
      `SELECT delivery.id, endpoint.url, endpoint.secret, delivery.body
       FROM payment_webhook_deliveries AS delivery
       JOIN payment_webhook_endpoints AS endpoint ON endpoint.id = delivery.endpoint_id
       WHERE delivery.delivered_at IS NULL AND delivery.next_attempt_at <= ?`,
    )
    .all(now) as WebhookDelivery[];

export const recordWebhookAttempt = (deliveryId: string, status: number | null, error: string | null, now = Date.now()) => {
  db.prepare("INSERT INTO payment_webhook_attempts (id, delivery_id, at, status, error) VALUES (?, ?, ?, ?, ?)").run(randomUUID(), deliveryId, now, status, error);
  if (status != null && status >= 200 && status < 300) {
    db.prepare("UPDATE payment_webhook_deliveries SET delivered_at = ? WHERE id = ?").run(now, deliveryId);
    return;
  }
  db.prepare("UPDATE payment_webhook_deliveries SET next_attempt_at = ? WHERE id = ?").run(now + WEBHOOK_RETRY_MS, deliveryId);
};

export const deliverDueWebhooks = async (now = Date.now()) => {
  for (const delivery of dueWebhookDeliveries(now)) {
    const timestamp = String(now);
    try {
      const response = await fetch(delivery.url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-payment-timestamp": timestamp,
          "x-payment-signature": signWebhook(delivery.secret, delivery.body, now),
        },
        body: delivery.body,
      });
      recordWebhookAttempt(delivery.id, response.status, null, now);
    } catch (error) {
      recordWebhookAttempt(delivery.id, null, error instanceof Error ? error.message : "delivery failed", now);
    }
  }
};

/** A webhook is a hint. It never changes a plan. */
export const acceptWebhookHint = (body: string) => {
  const payload = JSON.parse(body) as { invoiceId?: string; status?: string };
  const invoice = payload.invoiceId ? getInvoice(payload.invoiceId) : undefined;
  return { accepted: true, granted: false, status: invoice?.status ?? null };
};
