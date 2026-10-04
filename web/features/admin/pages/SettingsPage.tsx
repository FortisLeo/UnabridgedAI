import { useState, type FormEvent } from "react";
import { api } from "../../../lib/api.ts";
import { Panel, Rows, Table } from "../components/AdminPanel.tsx";
import type { AdminData } from "../types.ts";

type Price = { key: string; value: string };

export function SettingsPage({ data }: { data: AdminData }) {
  const initialPrices = (data.prices as Price[] | undefined) ?? [];
  const [prices, setPrices] = useState(initialPrices);
  const [priceInput, setPriceInput] = useState("");
  const [priceMessage, setPriceMessage] = useState("");
  const currentCents = prices.find((item) => item.key === "pro_price_cents")?.value;

  const savePrice = async (event: FormEvent) => {
    event.preventDefault();
    setPriceMessage("");
    try {
      const result = await api<{ key: string; cents: number; usd: string }>("/api/admin/settings/pricing", {
        method: "PUT",
        body: JSON.stringify({ proPriceUsd: priceInput || (currentCents ? (Number(currentCents) / 100).toFixed(2) : "") }),
      });
      setPriceInput(result.usd);
      setPrices((items) => [...items.filter((item) => item.key !== result.key), { key: result.key, value: String(result.cents) }].sort((a, b) => a.key.localeCompare(b.key)));
      setPriceMessage(`Saved at $${result.usd}.`);
    } catch (err) {
      setPriceMessage((err as Error).message);
    }
  };

  return <><Panel title="payment settings"><form className="admin-setting-form" onSubmit={savePrice}><label>Pro price (USD)<input inputMode="decimal" value={priceInput || (currentCents ? (Number(currentCents) / 100).toFixed(2) : "")} onChange={(event) => setPriceInput(event.target.value)} placeholder="15.00" /></label><button className="primary" type="submit">save price</button>{priceMessage && <span className={priceMessage.startsWith("Saved") ? "admin-ok" : "error"}>{priceMessage}</span>}</form><Table rows={prices} columns={["key", "value"]} /></Panel><Panel title="configured RPC endpoints"><Rows items={Object.entries((data.chains as Record<string, number>) ?? {}).map(([chain, count]) => ({ label: chain, value: `${count} configured` }))} /></Panel></>;
}
