import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const dom = new JSDOM('<div id="root"></div>', { url: "http://localhost" });
Object.assign(globalThis, { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
dom.window.HTMLElement.prototype.scrollTo = () => {};
const React = await import("react");
const { act, useState } = React;
const { createRoot } = await import("react-dom/client");
const { ChatView } = await import("./features/chat/ChatView.tsx");
const { SettingsPage } = await import("./features/settings/SettingsPage.tsx");
const { defaultSettings } = await import("./types.ts");
import type { Message } from "./types.ts";
const container = document.getElementById("root")!;
const originalFetch = globalThis.fetch;
const button = (label: string) => Array.from(container.querySelectorAll("button")).find((el) => el.textContent?.toLowerCase().startsWith(label))!;
const click = async (el: HTMLElement) => { await act(async () => el.click()); };
const input = async (el: HTMLTextAreaElement, value: string) => {
  await act(async () => {
    Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, "value")!.set!.call(el, value);
    el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  });
};
function Harness({ page }: { page: boolean }) {
  const [settings, setSettings] = useState(defaultSettings);
  const [messages, setMessages] = useState<Message[]>([]);
  return <><output>{JSON.stringify(settings)}</output>{page ? <SettingsPage settings={settings} setSettings={setSettings} onHistoryCleared={async () => {}} /> : <ChatView chatId={null} settings={settings} setSettings={setSettings} messages={messages} setMessages={setMessages} quota={null} onQuota={() => {}} onUpgrade={() => {}} onChatSaved={async () => {}} />}</>;
}
try {
  for (const page of [false, true]) {
    const requests: Array<{ patch: object; resolve: (value: Response) => void }> = [];
    globalThis.fetch = async (_url, init) => new Promise<Response>((resolve) => requests.push({ patch: JSON.parse(String(init?.body)), resolve }));
    const root = createRoot(container);
    await act(async () => root.render(<Harness page={page} />));
    await click(button(page ? "web search by default" : "web search"));
    await click(button(page ? "dark web search by default" : "dark web search"));
    assert.equal(requests.length, 2);
    if (page) await input(container.querySelector("textarea")!, "unsaved memory");
    for (const index of [1, 0]) await act(async () => requests[index].resolve(Response.json({ settings: { ...defaultSettings, ...requests[index].patch } })));
    const state = JSON.parse(container.querySelector("output")!.textContent!);
    assert.equal(state.webSearch, true);
    assert.equal(state.darkWebSearch, true);
    assert.ok(button(page ? "web search by default" : "web search").classList.contains("on"));
    assert.ok(button(page ? "dark web search by default" : "dark web search").classList.contains("on"));
    if (page) assert.equal(container.querySelector("textarea")!.value, "unsaved memory");
    await act(async () => root.unmount());
  }
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  globalThis.fetch = async () => new Response(new ReadableStream({ start(value) { controller = value; } }), { headers: { "Content-Type": "text/event-stream" } });
  const root = createRoot(container);
  await act(async () => root.render(<Harness page={false} />));
  await input(container.querySelector("textarea")!, "hello");
  await act(async () => container.querySelector("textarea")!.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
  await act(async () => controller.enqueue(new TextEncoder().encode('event: delta\ndata: {"text":"visible partial"}\n\n')));
  assert.ok(container.querySelector(".message.assistant")!.textContent!.includes("visible partial"));
  await act(async () => controller.error(new Error("stream interrupted")));
  const reply = container.querySelector(".message.assistant")!.textContent!;
  assert.ok(reply.includes("visible partial"));
  assert.ok(reply.includes("stream interrupted"));
  await act(async () => root.unmount());
  const css = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
  const mobile = css.match(/@media\(max-width:760px\)\{([\s\S]*)\}\s*$/)?.[1] ?? "";
  assert.ok(mobile.length > 0, "mobile breakpoint missing");
  for (const rule of [
    ".app{display:block",
    ".signout{display:inline-flex",
    ".auth{display:block",
    ".page-grid,.settings-grid,.feature-list,.crypto-choices{grid-template-columns:1fr",
    ".chat{height:auto",
    "header h1{font-size:20px;max-width:100%;white-space:normal",
    ".code-block pre,.snippet{overflow-x:auto",
  ]) assert.ok(mobile.includes(rule), rule);
  assert.ok(!/\.status,\.side-note,\.signout/.test(mobile), "sign out must stay available on narrow screens");
  assert.match(css, /overflow-wrap:anywhere/);
  assert.match(css, /100dvh/);
  const { Sidebar } = await import("./features/shell/Sidebar.tsx");
  const { AuthScreen } = await import("./features/auth/AuthScreen.tsx");
  const markupRoot = createRoot(container);
  await act(async () => markupRoot.render(
    <>
      <Sidebar chats={[{ id: "1", title: "A very long session title that must stay inside the rail", created_at: Date.now(), updated_at: Date.now() }]} activeChatId="1" view="chat" onNewSession={() => {}} onOpenChat={() => {}} onChangeView={() => {}} />
      <AuthScreen mode="signin" setMode={() => {}} onAuth={() => {}} error="" setError={() => {}} />
    </>,
  ));
  assert.ok(container.querySelector("aside .signout"));
  assert.ok(container.querySelector("aside nav"));
  assert.ok(container.querySelector(".auth-panel"));
  assert.ok(container.querySelector(".auth-art"));
  assert.equal(container.querySelectorAll("input").length, 2);
  await act(async () => markupRoot.unmount());
  console.log("component regressions passed");
} finally {
  globalThis.fetch = originalFetch;
  dom.window.close();
}
