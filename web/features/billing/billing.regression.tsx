import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { transformSync } from "esbuild";
import { JSDOM } from "jsdom";
import React from "react";
import { createRoot } from "react-dom/client";

const require = createRequire(import.meta.url);
const compiled = transformSync(readFileSync(new URL("./BillingPage.tsx", import.meta.url), "utf8"), {
  loader: "tsx",
  format: "cjs",
  jsx: "automatic",
}).code;
const pageModule = { exports: {} as { BillingPage?: (props: { onQuota?: (quota: unknown) => void }) => React.ReactElement } };
const localRequire = (id: string) => {
  if (id === "react") return React;
  if (id === "react/jsx-runtime") return require("react/jsx-runtime");
  if (id === "qrcode") return require("qrcode");
  if (id === "../../lib/api.ts") return {
    ApiError: class ApiError extends Error {
      status = 0;
      payload: Record<string, unknown> = {};
    },
    api: async (path: string) => {
      const response = await fetch(path);
      if (!response.ok) throw new Error("billing request failed");
      return response.json();
    },
  };
  return require(id);
};
new Function("exports", "require", "module", compiled)(pageModule.exports, localRequire, pageModule);
const BillingPage = pageModule.exports.BillingPage!;

const css = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
const dom = new JSDOM("<!doctype html><html><head></head><body><div id=\"root\"></div></body></html>", { url: "http://localhost", pretendToBeVisual: true });
const { window } = dom;
Object.assign(globalThis, {
  window,
  document: window.document,
  HTMLElement: window.HTMLElement,
  Node: window.Node,
  IS_REACT_ACT_ENVIRONMENT: true,
});
const style = window.document.createElement("style");
style.textContent = css;
window.document.head.appendChild(style);

const invoice = {
  id: "inv-1",
  chain: "ethereum",
  asset: "usdc",
  tokenContract: "0xcontract",
  address: "0x1111111111111111111111111111111111111111",
  displayAmount: "15.000000",
  status: "open",
  createdAt: Date.parse("2026-04-02T00:00:00.000Z"),
  quota: { plan: "free" as const, requestsUsed: 1, requestsLimit: 3, remaining: 2 },
};
const payment = {
  id: "inv-1",
  chain: "ethereum",
  asset: "usdc",
  displayAmount: "15.000000",
  status: "open",
  createdAt: Date.parse("2026-04-02T00:00:00.000Z"),
};
let payload: { quota: unknown; invoice: unknown; payments: unknown[] } = { quota: invoice.quota, invoice, payments: [payment] };
let invoicePayload: unknown = invoice;
let billingRequests = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  if (String(url).includes("/invoices/")) return Response.json(invoicePayload);
  billingRequests += 1;
  return Response.json(payload);
}) as typeof fetch;

const root = window.document.getElementById("root")!;
const { act } = await import("react");
const show = async () => {
  const reactRoot = createRoot(root);
  await act(async () => {
    reactRoot.render(React.createElement(BillingPage));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return reactRoot;
};

try {
  payload = {
    quota: { plan: "pro", requestsUsed: 4, requestsLimit: null, remaining: null },
    invoice: null,
    payments: [{ ...payment, status: "succeeded" }],
  };
  let reactRoot = await show();
  assert.equal(root.querySelector("img"), null, "Pro accounts must not show a payment QR");
  assert.equal(root.querySelector(".payment-loader"), null);
  const history = root.querySelector(".past-payments");
  assert.ok(history);
  assert.match(history.textContent ?? "", /2026-04-02/);
  assert.match(history.textContent ?? "", /ethereum/i);
  assert.match(history.textContent ?? "", /15\.000000/);
  assert.match(history.textContent ?? "", /succeeded/);

  payload = { quota: invoice.quota, invoice, payments: [payment] };
  await act(async () => reactRoot.unmount());
  reactRoot = await show();
  assert.ok(root.querySelector("img[alt='Payment address QR code']"));
  const loader = root.querySelector(".payment-loader");
  assert.ok(loader, "an unpaid invoice shows a loader");
  const spinner = root.querySelector(".payment-spinner");
  assert.ok(spinner);
  const rules = [...window.document.styleSheets].flatMap((sheet) => [...sheet.cssRules]);
  const spinnerRule = rules.find((rule) => "selectorText" in rule && rule.selectorText === ".payment-spinner") as CSSStyleRule | undefined;
  assert.ok(spinnerRule);
  assert.match(spinnerRule.style.animation, /payment-spin/);
  assert.match(spinnerRule.style.animation, /infinite/);
  assert.doesNotMatch(spinnerRule.style.animation, /(^|\s)0s(\s|$)/);
  const keyframes = rules.find((rule) => "name" in rule && rule.name === "payment-spin") as CSSKeyframesRule | undefined;
  assert.ok(keyframes);
  assert.match([...keyframes.cssRules].map((rule) => rule.cssText).join(" "), /rotate\(360deg\)/);
  assert.match(root.querySelector(".past-payments")?.textContent ?? "", /No payments yet/, "the active pending invoice is not listed as a past payment");
  assert.ok(root.textContent?.includes(invoice.address));

  Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
  window.matchMedia = (query: string) => ({
    matches: /max-width:\s*760px/.test(query),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent() { return false; },
    onchange: null,
  });
  const active = rules.flatMap((rule) => (rule instanceof window.CSSMediaRule ? (window.matchMedia(rule.conditionText).matches ? [...rule.cssRules] : []) : [rule]));
  const declared = (selector: string, property: string) => {
    const found = active.filter((rule): rule is CSSStyleRule => rule instanceof window.CSSStyleRule && rule.selectorText.split(",").some((part) => part.trim() === selector) && rule.style.getPropertyValue(property) !== "").at(-1);
    assert.ok(found, `${selector} ${property}`);
    return found.style.getPropertyValue(property);
  };
  assert.equal(declared(".page-grid", "grid-template-columns"), "1fr");
  assert.equal(declared(".page-grid", "overflow-x"), "hidden");
  assert.equal(declared(".plan-card", "overflow-x"), "hidden");
  assert.equal(declared(".crypto-choices", "grid-template-columns"), "1fr");
  assert.equal(declared(".upgrade", "min-height"), "44px");
  assert.equal(declared(".crypto-choices button", "min-height"), "44px");
  assert.equal(declared(".crypto-invoice img", "width"), "min(220px, 100%)");
  assert.equal(declared(".crypto-invoice .ledger-line", "display"), "grid");
  assert.equal(declared(".crypto-invoice .ledger-line code", "overflow-wrap"), "anywhere");
  const qr = root.querySelector("img");
  assert.match(qr?.getAttribute("alt") ?? "", /QR/);
  assert.equal(qr?.getAttribute("src")?.startsWith("data:image/"), true);

  await act(async () => reactRoot.unmount());
  const prior = { ...payment, id: "inv-0", status: "succeeded", createdAt: Date.parse("2026-03-01T00:00:00.000Z") };
  invoicePayload = invoice;
  payload = { quota: invoice.quota, invoice, payments: [payment, prior] };
  const pollers: (() => void)[] = [];
  const realSetInterval = window.setInterval;
  window.setInterval = ((handler: TimerHandler) => {
    if (typeof handler === "function") pollers.push(handler as () => void);
    return 0;
  }) as typeof window.setInterval;
  try {
    const beforeShow = billingRequests;
    reactRoot = await show();
    assert.equal(billingRequests, beforeShow + 1, "the initial load fetches the billing summary once");
    payload = { quota: { plan: "free", requestsUsed: 1, requestsLimit: 3, remaining: 2 }, invoice: null, payments: [prior, { ...payment, status: "wrong_asset" }] };
    assert.ok(root.querySelector(".payment-loader"), "the unpaid loader shows before payment");
    assert.match(root.querySelector(".past-payments")?.textContent ?? "", /2026-03-01/, "the prior settled payment is listed");
    assert.doesNotMatch(root.querySelector(".past-payments")?.textContent ?? "", /2026-04-02/, "the active pending invoice stays out of past payments");
    assert.equal(pollers.length, 1, "the unpaid invoice starts polling");

    const afterShow = billingRequests;
    invoicePayload = { ...invoice, status: "wrong_asset" };
    await act(async () => {
      pollers.at(-1)?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(billingRequests, afterShow, "the poll does not re-fetch the full billing history");
    const wrongAsset = root.querySelector(".crypto-invoice");
    assert.ok(wrongAsset, "a non-blocking unresolved status keeps the current payment block on screen");
    assert.ok(root.querySelector(".payment-loader"), "the loader keeps rotating when no payment was received");
    assert.match(wrongAsset.textContent ?? "", /wrong_asset/);
    assert.doesNotMatch(root.querySelector(".past-payments")?.textContent ?? "", /2026-04-02/, "the wrong-asset active invoice stays out of past payments");
    assert.match(root.querySelector(".past-payments")?.textContent ?? "", /2026-03-01/, "the prior settled payment is unchanged");

    invoicePayload = { ...invoice, status: "succeeded", quota: { plan: "pro", requestsUsed: 4, requestsLimit: null, remaining: null } };
    await act(async () => {
      pollers.at(-1)?.();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    assert.equal(billingRequests, afterShow, "the payment poll still uses only the invoice endpoint");
    assert.equal(root.querySelector(".payment-loader"), null, "the loader clears after payment");
    const refreshed = root.querySelector(".past-payments")?.textContent ?? "";
    assert.match(refreshed, /2026-03-01/, "a prior settled invoice remains in past payments");
    assert.match(refreshed, /2026-04-02/, "the just-paid active invoice now appears in past payments");
    assert.equal((refreshed.match(/15\.000000/g) ?? []).length, 2, "both paid invoices list their amount");
    assert.match(refreshed, /succeeded/, "the updated status is shown");
    assert.doesNotMatch(refreshed, /wrong_asset/, "the stale status is replaced in place");
  } finally {
    window.setInterval = realSetInterval;
  }
  console.log("billing payment history UI regressions passed");
} finally {
  globalThis.fetch = originalFetch;
  window.close();
}
