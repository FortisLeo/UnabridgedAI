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
  quota: { plan: "free" as const, requestsUsed: 1, requestsLimit: 3, remaining: 2 },
};
const payment = {
  id: "inv-1",
  chain: "ethereum",
  asset: "usdc",
  displayAmount: "15.000000",
  receivedDisplayAmount: "0.000000",
  status: "open",
  createdAt: Date.parse("2026-04-02T00:00:00.000Z"),
  settledAt: null as number | null,
};
let payload: { quota: unknown; invoice: unknown; payments: unknown[] } = { quota: invoice.quota, invoice, payments: [payment] };
const originalFetch = globalThis.fetch;
globalThis.fetch = (async (url: string) => {
  if (String(url).includes("/invoices/")) return Response.json(payload.invoice);
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
    invoice: { ...invoice, status: "succeeded", quota: { plan: "pro", requestsUsed: 4, requestsLimit: null, remaining: null } },
    payments: [{ ...payment, status: "succeeded", receivedDisplayAmount: "15.000000", settledAt: Date.parse("2026-04-03T00:00:00.000Z") }],
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
  assert.match(root.querySelector(".past-payments")?.textContent ?? "", /15\.000000/);
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
  console.log("billing payment history UI regressions passed");
} finally {
  globalThis.fetch = originalFetch;
  window.close();
}
