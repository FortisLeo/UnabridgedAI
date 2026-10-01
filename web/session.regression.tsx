import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLElement.prototype.scrollTo = () => {};

const React = await import("react");
const { act } = React;
const { createRoot } = await import("react-dom/client");
const { App } = await import("./app/App.tsx");
import type { ChatSummary } from "./types.ts";

const container = document.getElementById("root")!;
const originalFetch = globalThis.fetch;
const click = async (el: Element) => { await act(async () => (el as HTMLElement).click()); };
const input = async (el: HTMLInputElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
};

try {
  const saved: ChatSummary = { id: "11111111-1111-4111-8111-111111111111", title: "Saved session", pinned: 0, created_at: 1, updated_at: 2 };
  const sessionUser = { user: { id: "user-1", username: "returning", plan: "free" }, quota: { plan: "free", requestsUsed: 0, requestsLimit: 3, remaining: 3 }, settings: {} };
  const calls: Array<{ url: string; method?: string; body?: string }> = [];
  let signedIn = false;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, method: init?.method, body: typeof init?.body === "string" ? init.body : undefined });
    if (url === "/api/auth/signin") {
      signedIn = true;
      return Response.json(sessionUser);
    }
    if (url === "/api/me") return signedIn ? Response.json(sessionUser) : Response.json({ error: "Sign in required" }, { status: 401 });
    if (url === "/api/chats/11111111-1111-4111-8111-111111111111" && init?.method === "PATCH") return Response.json({ ok: true, chat: { ...saved, pinned: 1 } });
    if (url === "/api/chats/11111111-1111-4111-8111-111111111111" && init?.method === "DELETE") return Response.json({ ok: true });
    if (url === "/api/chats") return Response.json({ chats: [saved] });
    return Response.json({ error: `unexpected ${url}` }, { status: 500 });
  };
  const root = createRoot(container);
  await act(async () => root.render(<App />));
  assert.equal(container.querySelector(".auth") !== null, true);
  await input(container.querySelector("input[autocomplete='username']") as HTMLInputElement, "returning");
  await input(container.querySelector("input[type='password']") as HTMLInputElement, "password12345");
  await click(Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.toLowerCase().startsWith("enter unabridgedai"))!);
  assert.equal(container.textContent?.includes("Saved session"), true);
  assert.equal(calls.some((call) => call.url === "/api/chats" && !call.method), true);

  const session = () => Array.from(container.querySelectorAll(".chat-list button")).find((el) => el.textContent?.includes("Saved session"))!;
  await act(async () => session().dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })));
  const menu = container.querySelector("[role='menu']")!;
  assert.deepEqual(Array.from(menu.querySelectorAll("[role='menuitem']")).map((el) => el.textContent), ["Pin", "Search", "Delete"]);
  await click(Array.from(menu.querySelectorAll("button")).find((el) => el.textContent === "Pin")!);
  assert.equal(container.textContent?.includes("📌"), true);

  await act(async () => session().dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })));
  await click(Array.from(container.querySelectorAll("[role='menuitem']")).find((el) => el.textContent === "Search")!);
  const filter = container.querySelector("input[aria-label='Search sessions']") as HTMLInputElement;
  assert.equal(document.activeElement, filter);
  assert.equal(filter.value, "Saved session");
  await input(filter, "missing");
  assert.equal(container.textContent?.includes("no sessions match"), true);
  await input(filter, "saved");
  await act(async () => session().dispatchEvent(new dom.window.MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 })));
  await click(Array.from(container.querySelectorAll("[role='menuitem']")).find((el) => el.textContent === "Delete")!);
  assert.equal(container.querySelector("[role='dialog']")?.textContent?.includes("Delete"), true);
  await click(Array.from(container.querySelectorAll(".confirm-card button")).find((el) => el.textContent === "Delete")!);
  assert.equal(container.textContent?.includes("no saved sessions yet"), true);
  assert.equal(calls.some((call) => call.method === "DELETE" && call.url.endsWith(saved.id)), true);
  await act(async () => root.unmount());
  console.log("session regressions passed");
} finally {
  globalThis.fetch = originalFetch;
  dom.window.close();
}
