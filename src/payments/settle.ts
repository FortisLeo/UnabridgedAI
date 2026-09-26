import { db } from "../db/client.ts";
import { compareBaseUnits, parseBaseUnits } from "./amounts.ts";
import type { InvoiceRow, CreditRow } from "./store.ts";

export type InvoiceStatus =
  | "open"
  | "underpaid"
  | "overpaid"
  | "wrong_asset"
  | "exact_pending"
  | "succeeded"
  | "expired_unpaid"
  | "refund_pending"
  | "refunded";

const counts = (credit: CreditRow) => credit.disappeared_at == null && credit.locked === 0 && credit.wrong_asset === 0;

export const classify = (invoice: InvoiceRow, credits: CreditRow[], now: number, secondReadAgrees: boolean): InvoiceStatus => {
  if (invoice.status === "refund_pending" || invoice.status === "refunded") return invoice.status;
  const relevant = credits.filter(counts);
  const wrong = credits.some((credit) => credit.disappeared_at == null && (credit.wrong_asset === 1 || credit.locked === 1));
  const settledCredits = relevant.filter((credit) => credit.settled === 1);
  const grant = settledCredits.reduce((sum, credit) => sum + parseBaseUnits(credit.base_units), 0n);
  const unsettled = relevant.filter((credit) => credit.settled === 0).reduce((sum, credit) => sum + parseBaseUnits(credit.base_units), 0n);
  const expected = parseBaseUnits(invoice.expected_base_units);
  const seen = grant + unsettled;
  const confirmed = secondReadAgrees && settledCredits.length > 0 && settledCredits.every((credit) => credit.first_seen_at < now);
  if (grant === expected && confirmed) return "succeeded";
  if (grant > expected) return "overpaid";
  if (seen > 0n && (seen === expected || (seen > expected && grant < expected))) return "exact_pending";
  if (seen > 0n && seen < expected) return "underpaid";
  if (wrong && seen === 0n) return "wrong_asset";
  if (now > invoice.qr_expires_at) return "expired_unpaid";
  return "open";
};

export const applySettlement = (invoice: InvoiceRow, credits: CreditRow[], now: number, secondReadAgrees: boolean) => {
  const status = classify(invoice, credits, now, secondReadAgrees);
  const grant = db.transaction(() => {
    const current = db.prepare("SELECT plan FROM users WHERE id = ?").get(invoice.user_id) as { plan: string } | undefined;
    let alreadyPro = invoice.already_pro;
    let grantAppliedAt = invoice.grant_applied_at;
    let settledAt = invoice.settled_at;
    if (status === "succeeded" && grantAppliedAt == null) {
      if (current?.plan !== "pro") db.prepare("UPDATE users SET plan = 'pro' WHERE id = ?").run(invoice.user_id);
      else alreadyPro = 1;
      grantAppliedAt = now;
      settledAt = now;
    }
    db.prepare(
      "UPDATE payment_invoices SET status = ?, updated_at = ?, settled_at = ?, grant_applied_at = ?, already_pro = ?, second_read_ok = ? WHERE id = ?",
    ).run(status, now, settledAt, grantAppliedAt, alreadyPro, secondReadAgrees ? 1 : invoice.second_read_ok, invoice.id);
    db.prepare("INSERT INTO payment_events (invoice_id, user_id, at, kind, detail) VALUES (?, ?, ?, 'status', ?)").run(
      invoice.id,
      invoice.user_id,
      now,
      JSON.stringify({ status }),
    );
    return { status, alreadyPro, grantAppliedAt };
  })();
  return { status: grant.status, granted: grant.grantAppliedAt != null, alreadyPro: grant.alreadyPro === 1 };
};

export const sums = (invoice: InvoiceRow, credits: CreditRow[]) => {
  const relevant = credits.filter(counts);
  const received = relevant.reduce((sum, credit) => sum + parseBaseUnits(credit.base_units), 0n);
  const expected = parseBaseUnits(invoice.expected_base_units);
  const remaining = received >= expected ? 0n : expected - received;
  return {
    received,
    remaining,
    comparison: compareBaseUnits(received.toString(), expected.toString()),
  };
};
