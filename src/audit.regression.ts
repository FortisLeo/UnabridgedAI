/**
 * Regression coverage for the evidenced audit bugs, excluding the paywall copy.
 * Runs against an in-process Express app and a stubbed provider. No network.
 */
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import type { Express } from "express";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Markdown } from "../web/lib/markdown.tsx";

process.env.DB_PATH = join(mkdtempSync(join(tmpdir(), "uai-audit-")), "audit.db");
process.env.ZERO_ZERO_API_KEY = "test-not-real";
process.env.NODE_ENV = "production";
delete process.env.TRUST_PROXY;
delete process.env.COOKIE_SECURE;

type FetchInit = RequestInit & { headers?: Record<string, string> };

const { db } = await import("./db/client.ts");
const { createApp, errorHandler } = await import("./app.ts");
await import("./services/llm.ts");

type Upstream = { status: number; body: string; contentType?: string };
let upstreamQueue: Upstream[] = [];
let upstreamBodies: string[] = [];
const originalFetch = globalThis.fetch;

const sseChunk = (text: string, finish: string | null = null) =>
  `data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: finish }] })}\n\n`;

const jsonCompletion = (text: string) =>
  JSON.stringify({ id: "cmpl", object: "chat.completion", choices: [{ message: { role: "assistant", content: text }, finish_reason: "stop" }] });

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.startsWith("https://api.0-0.pro/")) {
    upstreamBodies.push(typeof init?.body === "string" ? init.body : "");
    const next = upstreamQueue.shift();
    if (!next) return new Response("missing stub", { status: 599 });
    return new Response(next.body, {
      status: next.status,
      headers: { "Content-Type": next.contentType ?? "application/json" },
    });
  }
  return originalFetch(input, init);
}) as typeof fetch;

const app = createApp();
app.use(errorHandler);
const server: Server = createServer(app as Express);
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as AddressInfo).port;
const base = `http://127.0.0.1:${port}`;

const readSse = async (response: Response) => {
  const text = await response.text();
  const events = text.split("\n\n").flatMap((frame) => {
    const event = frame.match(/^event: (.+)$/m)?.[1];
    const dataLine = frame.match(/^data: (.+)$/m)?.[1];
    if (!event || !dataLine) return [];
    return [{ event, data: JSON.parse(dataLine) as Record<string, unknown> }];
  });
  return { text, events };
};

const cookieOf = (response: Response) => {
  const raw = response.headers.getSetCookie?.() ?? [];
  const line = raw.find((item) => item.startsWith("unabridged_session="));
  if (!line) return "";
  return line.split(";")[0];
};

let seq = 0;
const signup = async (username = `user${++seq}`, password = "password12345", headers: Record<string, string> = {}) => {
  const response = await fetch(`${base}/api/auth/signup`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify({ username, password }),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body, cookie: cookieOf(response), username, password };
};

const authed = (cookie: string, path: string, init: FetchInit = {}) =>
  fetch(`${base}${path}`, {
    ...init,
    headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers, Cookie: cookie },
  });

const checks: Array<[string, () => Promise<void>]> = [];
const test = (name: string, fn: () => Promise<void>) => checks.push([name, fn]);

test("empty browser generation returns 502 without charging", async () => {
  const user = await signup();
  upstreamQueue = Array.from({ length: 2 }, () => ({ status: 200, body: "data: [DONE]\n\n", contentType: "text/event-stream" }));
  const response = await authed(user.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ content: "hello" }) });
  assert.equal(response.status, 502);
  const row = db.prepare("SELECT requests_used FROM users WHERE username = ?").get(user.username) as { requests_used: number };
  assert.equal(row.requests_used, 0);
});

test("API null replies release quota and tool replies remain usable", async () => {
  const user = await signup();
  const created = await authed(user.cookie, "/api/keys", { method: "POST", body: JSON.stringify({ name: "tools" }) });
  const key = await created.json();
  const tool = { id: "call_1", type: "function", function: { name: "lookup", arguments: "{}" } };
  for (const stream of [false, true]) {
    for (const usable of [false, true]) {
      const payload = usable ? { choices: [{ [stream ? "delta" : "message"]: { content: null, tool_calls: [tool] }, finish_reason: "tool_calls" }] } : null;
      upstreamQueue = [{ status: 200, body: stream ? `data: ${JSON.stringify(payload)}\n\ndata: [DONE]\n\n` : JSON.stringify(payload), contentType: stream ? "text/event-stream" : "application/json" }];
      const response = await fetch(`${base}/v1/chat/completions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
        body: JSON.stringify({ stream, messages: [{ role: "user", content: "lookup" }] }),
      });
      assert.equal(response.status, stream || usable ? 200 : 502);
      await response.text();
      const row = db.prepare("SELECT requests_used FROM users WHERE username = ?").get(user.username) as { requests_used: number };
      assert.equal(row.requests_used, (stream ? 1 : 0) + Number(usable));
    }
  }
});

test("provider retry preserves the final error body", async () => {
  upstreamQueue = [
    { status: 500, body: JSON.stringify({ error: { message: "first failure" } }) },
    { status: 500, body: JSON.stringify({ error: { message: "second failure" } }) },
    { status: 500, body: JSON.stringify({ error: { message: "final failure" } }) },
  ];
  const user = await signup();
  const created = await authed(user.cookie, "/api/keys", { method: "POST", body: JSON.stringify({ name: "retry" }) });
  const key = await created.json();
  const response = await fetch(`${base}/v1/chat/completions`, { method: "POST", headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" }, body: JSON.stringify({ messages: [{ role: "user", content: "hi" }] }) });
  const body = await response.json();
  assert.equal(body.error.message, "final failure");
});

test("settings ordering and partial replies remain visible in components", async () => {
  execFileSync(process.execPath, ["--import", "tsx", "web/ui.regression.tsx"], { env: { ...process.env, TSX_TSCONFIG_PATH: "tsconfig.web.json" }, stdio: "pipe" });
});

test("settings patches preserve concurrent fields", async () => {
  const user = await signup();
  const responses = await Promise.all([
    authed(user.cookie, "/api/settings", { method: "PUT", body: JSON.stringify({ webSearch: true }) }),
    authed(user.cookie, "/api/settings", { method: "PUT", body: JSON.stringify({ darkWebSearch: true }) }),
  ]);
  assert.equal(responses[0].status, 200);
  assert.equal(responses[1].status, 200);
  const settings = await (await authed(user.cookie, "/api/settings")).json();
  assert.equal(settings.settings.webSearch, true);
  assert.equal(settings.settings.darkWebSearch, true);
});

test("partial browser replies are preserved", async () => {
  upstreamQueue = [{ status: 200, body: sseChunk("partial"), contentType: "text/event-stream" }];
  const user = await signup();
  const response = await authed(user.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ content: "hello" }) });
  assert.equal(response.status, 200);
  const sse = await readSse(response);
  assert.equal(sse.events.find((event) => event.event === "done")?.data.reply, "partial");
});

test("markdown rejects non-http links", async () => {
  const html = renderToStaticMarkup(React.createElement(Markdown, { text: "[mail](mailto:test@example.com) [ftp](ftp://example.com) [web](https://example.com)" }));
  assert.equal(html.includes("mailto:"), false);
  assert.equal(html.includes("ftp://"), false);
  assert.equal(html.includes('href="https://example.com"'), true);
});

test("failed chat does not leave an empty session or burn quota", async () => {
  upstreamQueue = [{ status: 401, body: JSON.stringify({ error: { message: "invalid api key" } }) }];
  const user = await signup();
  assert.equal(user.response.status, 200);
  const chat = await authed(user.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ content: "hello audit" }) });
  assert.equal(chat.status, 502);
  assert.equal(chat.headers.get("content-type")?.includes("text/event-stream"), false);
  const body = await chat.json();
  assert.match(body.error, /not authorized|unavailable/i);
  const chats = await authed(user.cookie, "/api/chats");
  const listed = await chats.json();
  assert.equal(listed.chats.length, 0);
  const row = db.prepare("SELECT requests_used FROM users WHERE username = ?").get(user.username) as { requests_used: number };
  assert.equal(row.requests_used, 0);
  const ghosts = db.prepare("SELECT COUNT(*) AS count FROM chats").get() as { count: number };
  assert.equal(ghosts.count, 0);
});

test("a successful chat is stored once and counts as one request", async () => {
  upstreamQueue = [{ status: 200, body: `${sseChunk("Hello")}${sseChunk("", "stop")}data: [DONE]\n\n`, contentType: "text/event-stream" }];
  const user = await signup();
  const chat = await authed(user.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ content: "say hello" }) });
  assert.equal(chat.status, 200);
  assert.match(chat.headers.get("content-type") ?? "", /text\/event-stream/);
  const sse = await readSse(chat);
  const done = sse.events.find((event) => event.event === "done");
  assert.equal(done?.data.reply, "Hello");
  const body = { chat: done?.data.chat as { id: string } };
  assert.ok(body.chat?.id);
  const messages = db.prepare("SELECT role FROM messages WHERE chat_id = ? ORDER BY created_at").all(body.chat.id) as Array<{ role: string }>;
  assert.deepEqual(messages.map((row) => row.role), ["user", "assistant"]);
  const used = db.prepare("SELECT requests_used FROM users WHERE id = ?").get(body.chat ? (db.prepare("SELECT user_id FROM chats WHERE id = ?").get(body.chat.id) as { user_id: string }).user_id : "") as { requests_used: number };
  assert.equal(used.requests_used, 1);
});

test("concurrent sends cannot all pass the last free request", async () => {
  const user = await signup();
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string }).id;
  db.prepare("UPDATE users SET requests_used = 2 WHERE id = ?").run(id);
  upstreamQueue = [
    { status: 200, body: `${sseChunk("one")}${sseChunk("", "stop")}data: [DONE]\n\n`, contentType: "text/event-stream" },
    { status: 200, body: `${sseChunk("two")}${sseChunk("", "stop")}data: [DONE]\n\n`, contentType: "text/event-stream" },
  ];
  const [a, b] = await Promise.all([
    authed(user.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ content: "first" }) }),
    authed(user.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ content: "second" }) }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 402]);
  const used = db.prepare("SELECT requests_used FROM users WHERE id = ?").get(id) as { requests_used: number };
  assert.equal(used.requests_used, 3);
});

test("OpenAI route does not charge a non-ok provider response", async () => {
  upstreamQueue = [
    { status: 401, body: JSON.stringify({ error: { message: "invalid api key" } }) },
    { status: 401, body: JSON.stringify({ error: { message: "invalid api key" } }) },
    { status: 401, body: JSON.stringify({ error: { message: "invalid api key" } }) },
  ];
  const user = await signup();
  const created = await authed(user.cookie, "/api/keys", { method: "POST", body: JSON.stringify({ name: "probe" }) });
  const key = await created.json();
  const completion = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "unabridged", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(completion.status, 502);
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string }).id;
  const used = db.prepare("SELECT requests_used FROM users WHERE id = ?").get(id) as { requests_used: number };
  assert.equal(used.requests_used, 0);
});

test("OpenAI route releases the claim when a 200 body is not a completion", async () => {
  upstreamQueue = [{ status: 200, body: JSON.stringify({ error: { message: "overloaded" } }) }];
  const user = await signup();
  const created = await authed(user.cookie, "/api/keys", { method: "POST", body: JSON.stringify({ name: "probe" }) });
  const key = await created.json();
  const completion = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "unabridged", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(completion.status, 502);
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string }).id;
  const used = db.prepare("SELECT requests_used FROM users WHERE id = ?").get(id) as { requests_used: number };
  assert.equal(used.requests_used, 0);
});

test("OpenAI stream charges usable completions and releases unusable ones", async () => {
  const finished = `${sseChunk("hi")}${sseChunk("", "stop")}data: [DONE]\n\n`;
  const broken = sseChunk("partial");
  const empty = "data: [DONE]\n\n";
  upstreamQueue = [
    { status: 200, body: finished, contentType: "text/event-stream" },
    { status: 200, body: broken, contentType: "text/event-stream" },
    { status: 200, body: empty, contentType: "text/event-stream" },
  ];
  const user = await signup();
  const created = await authed(user.cookie, "/api/keys", { method: "POST", body: JSON.stringify({ name: "stream" }) });
  const key = await created.json();
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string }).id;
  const ok = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "unabridged", stream: true, messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(ok.status, 200);
  await ok.text();
  const afterOk = db.prepare("SELECT requests_used FROM users WHERE id = ?").get(id) as { requests_used: number };
  assert.equal(afterOk.requests_used, 1);
  const bad = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "unabridged", stream: true, messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(bad.status, 200);
  await bad.text();
  const afterBad = db.prepare("SELECT requests_used FROM users WHERE id = ?").get(id) as { requests_used: number };
  assert.equal(afterBad.requests_used, 1);
  const emptyResponse = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "unabridged", stream: true, messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(emptyResponse.status, 200);
  await emptyResponse.text();
  const afterEmpty = db.prepare("SELECT requests_used FROM users WHERE id = ?").get(id) as { requests_used: number };
  assert.equal(afterEmpty.requests_used, 1);
});

test("the fourth free request is rejected", async () => {
  const user = await signup();
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string }).id;
  upstreamQueue = Array.from({ length: 3 }, () => ({ status: 200, body: `${sseChunk("ok")}${sseChunk("", "stop")}data: [DONE]\n\n`, contentType: "text/event-stream" }));
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await authed(user.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ content: `request ${attempt}` }) });
    assert.equal(response.status, 200);
    await response.text();
  }
  const fourth = await authed(user.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ content: "request 4" }) });
  assert.equal(fourth.status, 402);
  const used = db.prepare("SELECT requests_used FROM users WHERE id = ?").get(id) as { requests_used: number };
  assert.equal(used.requests_used, 3);
  const created = await authed(user.cookie, "/api/keys", { method: "POST", body: JSON.stringify({ name: "fourth" }) });
  const key = await created.json();
  const api = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "unabridged", messages: [{ role: "user", content: "request 4" }] }),
  });
  assert.equal(api.status, 402);
});

test("API quota exhaustion uses the web 402 status", async () => {
  const user = await signup();
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string }).id;
  db.prepare("UPDATE users SET requests_used = 3 WHERE id = ?").run(id);
  const created = await authed(user.cookie, "/api/keys", { method: "POST", body: JSON.stringify({ name: "quota" }) });
  const key = await created.json();
  const response = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "unabridged", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(response.status, 402);
});

test("OpenAI route charges a finished completion once", async () => {
  upstreamQueue = [{ status: 200, body: jsonCompletion("ok") }];
  const user = await signup();
  const created = await authed(user.cookie, "/api/keys", { method: "POST", body: JSON.stringify({ name: "probe" }) });
  const key = await created.json();
  const completion = await fetch(`${base}/v1/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key.secret}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "unabridged", messages: [{ role: "user", content: "hi" }] }),
  });
  assert.equal(completion.status, 200);
  const id = (db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string }).id;
  const used = db.prepare("SELECT requests_used FROM users WHERE id = ?").get(id) as { requests_used: number };
  assert.equal(used.requests_used, 1);
});

test("X-Forwarded-For does not choose the signup address or skip a real blacklist", async () => {
  const user = await signup("spoofeduser", "password12345", { "X-Forwarded-For": "203.0.113.9", "X-Forwarded-Proto": "https" });
  assert.equal(user.response.status, 200);
  const stored = db.prepare("SELECT signup_ip FROM users WHERE username = ?").get("spoofeduser") as { signup_ip: string };
  assert.notEqual(stored.signup_ip, "203.0.113.9");
  assert.match(stored.signup_ip, /^(127\.|::1)/);
  const setCookie = user.response.headers.get("set-cookie") ?? "";
  assert.equal(/;\s*Secure/i.test(setCookie), false, "spoofed proto must not force Secure");
  db.prepare("INSERT INTO ip_blacklist VALUES ('203.0.113.9', 'planted', ?)").run(Date.now());
  const again = await signup("spoofeduser2", "password12345", { "X-Forwarded-For": "203.0.113.9" });
  assert.equal(again.response.status, 200);
});

test("startup preserves a pre-existing private blacklist row", async () => {
  const directory = mkdtempSync(join(tmpdir(), "uai-blacklist-startup-"));
  const database = join(directory, "audit.db");
  const script = "import Database from 'better-sqlite3'; const db = new Database(process.env.DB_PATH); db.exec(`CREATE TABLE ip_blacklist (ip TEXT PRIMARY KEY, reason TEXT NOT NULL, created_at INTEGER NOT NULL); INSERT INTO ip_blacklist VALUES ('127.0.0.1', 'private', 1);`); db.close(); import('./src/db/client.ts').then(({ db }) => { if (!db.prepare(\"SELECT 1 FROM ip_blacklist WHERE ip='127.0.0.1'\").get()) process.exit(1); });";
  execFileSync(process.execPath, ["--import", "tsx", "-e", script], { cwd: process.cwd(), env: { ...process.env, DB_PATH: database } });
});

test("private blacklist rows survive initialization and block requests", async () => {
  db.prepare("INSERT OR REPLACE INTO ip_blacklist VALUES ('127.0.0.1', 'test', ?)").run(Date.now());
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM ip_blacklist WHERE ip = '127.0.0.1'").get() as { count: number }).count, 1);
  const blocked = await signup("blockednet");
  assert.equal(blocked.response.status, 403);
  assert.equal((db.prepare("SELECT COUNT(*) AS count FROM ip_blacklist WHERE ip = '127.0.0.1'").get() as { count: number }).count, 1);
  db.prepare("DELETE FROM ip_blacklist WHERE ip = '127.0.0.1'").run();
});

test("case-variant usernames are one account and sign-in trims", async () => {
  const first = await signup("CaseUser");
  assert.equal(first.response.status, 200);
  const second = await signup("caseuser");
  assert.equal(second.response.status, 409);
  const signin = await fetch(`${base}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "  CASEUSER  ", password: "password12345" }),
  });
  assert.equal(signin.status, 200);
  const body = await signin.json();
  assert.equal(body.user.username, "CaseUser");
});

test("renaming a chat does not un-archive it", async () => {
  const user = await signup();
  const id = crypto.randomUUID();
  const now = Date.now();
  const owner = (db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string }).id;
  db.prepare("INSERT INTO chats VALUES (?, ?, 'old', 1, ?, ?)").run(id, owner, now, now);
  const patched = await authed(user.cookie, `/api/chats/${id}`, { method: "PATCH", body: JSON.stringify({ title: "still archived?" }) });
  assert.equal(patched.status, 200);
  const row = db.prepare("SELECT archived, title FROM chats WHERE id = ?").get(id) as { archived: number; title: string };
  assert.equal(row.archived, 1);
  assert.equal(row.title, "still archived?");
  const list = await (await authed(user.cookie, "/api/chats")).json();
  assert.equal(list.chats.some((chat: { id: string }) => chat.id === id), false);
});

test("stale primary cookies fall back to a valid legacy session", async () => {
  const user = await signup();
  const legacy = user.cookie.replace(/^unabridged_session=/, "n4n1_session=");
  const response = await authed(`unabridged_session=stale; ${legacy}`, "/api/me");
  assert.equal(response.status, 200);
});

test("sign-out removes presented sessions without revoking other devices", async () => {
  const user = await signup();
  const again = await fetch(`${base}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: user.password }),
  });
  assert.equal(again.status, 200);
  const second = cookieOf(again);
  const thirdResponse = await fetch(`${base}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: user.username, password: user.password }),
  });
  assert.equal(thirdResponse.status, 200);
  const third = cookieOf(thirdResponse);
  const legacy = second.replace(/^unabridged_session=/, "n4n1_session=");
  const owner = (db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string }).id;
  const before = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?").get(owner) as { count: number };
  assert.ok(before.count >= 2);
  const out = await authed(`${user.cookie}; ${legacy}`, "/api/auth/signout", { method: "POST" });
  assert.equal(out.status, 200);
  const me = await authed(user.cookie, "/api/me");
  assert.equal(me.status, 401);
  const remaining = await authed(second, "/api/me");
  assert.equal(remaining.status, 401);
  const otherDevice = await authed(third, "/api/me");
  assert.equal(otherDevice.status, 200);
  const left = db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE user_id = ?").get(owner) as { count: number };
  assert.equal(left.count, 1);
});

test("an API key cannot export the account, and rotate revokes the old key", async () => {
  const user = await signup();
  const created = await authed(user.cookie, "/api/keys", { method: "POST", body: JSON.stringify({ name: "leak" }) });
  const key = await created.json();
  const exported = await fetch(`${base}/api/data/export`, { headers: { Authorization: `Bearer ${key.secret}` } });
  assert.equal(exported.status, 401);
  const me = await fetch(`${base}/api/me`, { headers: { Authorization: `Bearer ${key.secret}` } });
  assert.equal(me.status, 401);
  const models = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${key.secret}` } });
  assert.equal(models.status, 200);
  const rotated = await authed(user.cookie, "/api/keys/rotate", { method: "POST", body: JSON.stringify({ id: key.key.id }) });
  assert.equal(rotated.status, 200);
  const next = await rotated.json();
  assert.ok(next.secret);
  assert.equal(next.apiKey, undefined);
  const oldModels = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${key.secret}` } });
  assert.equal(oldModels.status, 401);
  const newModels = await fetch(`${base}/v1/models`, { headers: { Authorization: `Bearer ${next.secret}` } });
  assert.equal(newModels.status, 200);
});

test("history-disabled chats do not load foreign history", async () => {
  upstreamBodies = [];
  const alice = await signup();
  const saved = await authed(alice.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ content: "private history" }) });
  const savedSse = await readSse(saved);
  const savedChat = savedSse.events.find((event) => event.event === "done")?.data.chat as { id: string };
  const bob = await signup();
  await authed(bob.cookie, "/api/settings", { method: "PUT", body: JSON.stringify({ saveHistory: false }) });
  upstreamQueue = [{ status: 200, body: `${sseChunk("ok")}${sseChunk("", "stop")}data: [DONE]\n\n`, contentType: "text/event-stream" }];
  const response = await authed(bob.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ chatId: savedChat.id, content: "new question" }) });
  assert.equal(response.status, 200);
  assert.equal((upstreamBodies.at(-1) ?? "").includes("private history"), false);
});

test("temporary chat does not feed another user's history", async () => {
  upstreamBodies = [];
  upstreamQueue = [{ status: 200, body: `${sseChunk("owned")}${sseChunk("", "stop")}data: [DONE]\n\n`, contentType: "text/event-stream" }];
  const alice = await signup();
  const saved = await authed(alice.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ content: "secret fact" }) });
  const savedSse = await readSse(saved);
  const savedChat = savedSse.events.find((event) => event.event === "done")?.data.chat as { id: string };
  const bob = await signup();
  await authed(bob.cookie, "/api/settings", { method: "PUT", body: JSON.stringify({ temporaryChat: true }) });
  upstreamQueue = [{ status: 200, body: `${sseChunk("temp")}${sseChunk("", "stop")}data: [DONE]\n\n`, contentType: "text/event-stream" }];
  const stolen = await authed(bob.cookie, "/api/chat", { method: "POST", body: JSON.stringify({ chatId: savedChat.id, content: "what was said" }) });
  assert.equal(stolen.status, 200);
  const temporaryRequest = upstreamBodies.at(-1) ?? "";
  assert.equal(temporaryRequest.includes("secret fact"), false);
  assert.equal(temporaryRequest.includes("owned"), false);
  const messages = db.prepare("SELECT COUNT(*) AS count FROM messages WHERE chat_id = ?").get(savedChat.id) as { count: number };
  assert.equal(messages.count, 2);
});

test("malformed JSON does not echo the parser message", async () => {
  const response = await fetch(`${base}/api/auth/signin`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{",
  });
  const text = await response.text();
  assert.equal(response.status, 400);
  assert.equal(text.includes("position"), false);
  assert.match(text, /Invalid JSON/);
});

test("health checks the database", async () => {
  const response = await fetch(`${base}/api/health`);
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.db, true);
});

test("sidebar lists all visible chats", async () => {
  const user = await signup();
  const owner = (db.prepare("SELECT id FROM users WHERE username = ?").get(user.username) as { id: string }).id;
  const insert = db.prepare("INSERT INTO chats VALUES (?, ?, ?, 0, ?, ?)");
  for (let i = 0; i < 101; i += 1) insert.run(crypto.randomUUID(), owner, `chat ${i}`, i, i);
  const list = await (await authed(user.cookie, "/api/chats")).json();
  assert.equal(list.chats.length, 101);
  assert.equal("truncated" in list, false);
  assert.equal("total" in list, false);
});

let failed = 0;
for (const [name, fn] of checks) {
  try {
    await fn();
    console.log(`ok  ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

await new Promise<void>((resolve) => server.close(() => resolve()));
if (failed) {
  console.error(`${failed} regression test(s) failed`);
  process.exitCode = 1;
} else {
  console.log(`${checks.length} regression tests passed`);
}
