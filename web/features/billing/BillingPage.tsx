import { useEffect, useState } from "react";
import { api } from "../../lib/api.ts";
import type { Quota } from "../../types.ts";

export function BillingPage({ onQuota }: { onQuota?: (quota: Quota) => void }) {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ quota: Quota }>("/api/billing")
      .then((data) => {
        setQuota(data.quota);
        if (data.quota) onQuota?.(data.quota);
      })
      .catch((err) => setError((err as Error).message));
  }, [onQuota]);

  const pro = quota?.plan === "pro";

  return (
    <section className="page-grid">
      <div className="plan-card">
        <div className="plan-top"><span className="tag">UNABRIDGEDAI / PROTOCOL</span><span className="price">{pro ? "pro" : "free"}</span></div>
        <h2>{pro ? "Pro is active." : "Free channel."}</h2>
        <p>Free accounts get 10 messages. Pro removes the cap. Purchases are currently disabled.</p>
        <div className="features">
          <span>✓ 10 free requests</span>
          <span>✓ unlimited after Pro</span>
          <span>✓ no payment processor</span>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="payment">
          <span>status</span>
          <code>{pro ? "pro" : quota ? `${quota.remaining ?? 0} free left` : "loading"}</code>
        </div>
      </div>
      <div className="ledger">
        <div className="eyebrow">access plan</div>
        <h3>quota</h3>
        <p>Usage is tracked per account. New signups from the same network will not reset the free limit.</p>
        <div className="ledger-line"><span>plan</span><strong>{quota?.plan ?? "…"}</strong></div>
        <div className="ledger-line"><span>used</span><strong>{quota?.requestsUsed ?? "…"}</strong></div>
        <div className="ledger-line"><span>remaining</span><strong className="amber">{pro ? "unlimited" : quota?.remaining ?? "…"}</strong></div>
      </div>
    </section>
  );
}
