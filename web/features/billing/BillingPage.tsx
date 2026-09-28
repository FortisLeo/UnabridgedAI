import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { ApiError, api } from "../../lib/api.ts";
import type { Quota } from "../../types.ts";

type Invoice = {
  id: string;
  chain: string;
  asset: string;
  tokenContract: string | null;
  address: string;
  displayAmount: string;
  status: string;
  quota: Quota | null;
};

const choices = [
  ["ethereum", "usdt", "USDT", "Ethereum"],
  ["ethereum", "usdc", "USDC", "Ethereum"],
  ["polygon", "usdt", "USDT0", "Polygon"],
  ["polygon", "usdc", "USDC", "Polygon"],
  ["solana", "usdt", "USDT", "Solana"],
  ["solana", "usdc", "USDC", "Solana"],
  ["monero", "xmr", "XMR", "Monero"],
] as const;

const labelFor = (chain: string, asset: string) =>
  choices.find(([choiceChain, choiceAsset]) => choiceChain === chain && choiceAsset === asset)?.[2] ?? asset.toUpperCase();

export function BillingPage({ onQuota }: { onQuota?: (quota: Quota) => void }) {
  const [quota, setQuota] = useState<Quota | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [qr, setQr] = useState("");
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ quota: Quota; invoice: Invoice | null }>("/api/billing")
      .then((data) => {
        setQuota(data.quota);
        if (data.invoice) setInvoice(data.invoice);
        if (data.quota) onQuota?.(data.quota);
      })
      .catch((err) => setError((err as Error).message));
  }, [onQuota]);

  useEffect(() => {
    if (!invoice) return undefined;
    const refresh = () => {
      api<Invoice>(`/api/billing/invoices/${invoice.id}`)
        .then((data) => {
          setInvoice(data);
          if (data.quota) {
            setQuota(data.quota);
            onQuota?.(data.quota);
          }
        })
        .catch((err) => setError((err as Error).message));
    };
    const timer = window.setInterval(refresh, 5000);
    return () => window.clearInterval(timer);
  }, [invoice?.id, onQuota]);

  useEffect(() => {
    if (!invoice) return;
    QRCode.toDataURL(invoice.address, { margin: 1, width: 220, color: { dark: "#111210", light: "#f4f1e8" } })
      .then(setQr)
      .catch(() => setError("The payment QR could not be created."));
  }, [invoice?.address]);

  const createInvoice = (chain: string, asset: string) => {
    setPaying(true);
    setError("");
    api<Invoice>("/api/billing/invoices", { method: "POST", body: JSON.stringify({ chain, asset }) })
      .then((data) => {
        setInvoice(data);
        setChoosing(false);
      })
      .catch((err) => {
        const openId = err instanceof ApiError ? err.payload.invoiceId : undefined;
        if (typeof openId === "string") {
          api<Invoice>(`/api/billing/invoices/${openId}`)
            .then((data) => {
              setInvoice(data);
              setChoosing(false);
              setError("");
            })
            .catch(() => setError((err as Error).message));
          return;
        }
        setError((err as Error).message);
      })
      .finally(() => setPaying(false));
  };

  const pro = quota?.plan === "pro";
  const assetLabel = invoice ? labelFor(invoice.chain, invoice.asset) : "";

  return (
    <section className="page-grid">
      <div className="plan-card">
        <div className="plan-top"><span className="tag">UNABRIDGEDAI / PROTOCOL</span><span className="price">{pro ? "pro" : "free"}</span></div>
        <h2>{pro ? "Pro is active." : "Free channel."}</h2>
        <p>Free accounts get 3 messages. Pro removes the cap. Choose a network and send the exact amount to the fresh address.</p>
        <div className="features">
          <span>✓ 3 free requests</span>
          <span>✓ unlimited after Pro</span>
          <span>✓ exact crypto payment</span>
        </div>
        {error && <div className="error">{error}</div>}
        <div className="payment">
          <span>status</span>
          <code>{pro ? "pro" : quota ? `${quota.remaining ?? 0} free left` : "loading"}</code>
        </div>
        {!pro && !invoice && <button className="upgrade" onClick={() => setChoosing(true)}>pay with crypto</button>}
        {choosing && !invoice && (
          <div className="crypto-choices">
            {choices.map(([chain, asset, label, network]) => (
              <button key={`${chain}-${asset}`} disabled={paying} onClick={() => createInvoice(chain, asset)}>
                <strong>{label}</strong><small>{network}</small>
              </button>
            ))}
          </div>
        )}
        {invoice && (
          <div className="crypto-invoice">
            {qr && <img src={qr} alt="Payment address QR code" />}
            <div className="ledger-line"><span>amount</span><strong>{invoice.displayAmount} {assetLabel}</strong></div>
            <div className="ledger-line"><span>network</span><strong>{invoice.chain}</strong></div>
            {invoice.tokenContract && <div className="ledger-line"><span>contract</span><code>{invoice.tokenContract}</code></div>}
            <div className="ledger-line"><span>address</span><code>{invoice.address}</code></div>
            <div className="ledger-line"><span>payment</span><strong className="amber">{invoice.status}</strong></div>
          </div>
        )}
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
