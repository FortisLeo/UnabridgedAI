import { env } from "../lib/env.ts";
import type { SearchHit } from "../types.ts";

const decodeEntities = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const fetchText = async (url: string, init: RequestInit = {}, timeoutMs = 12000) => {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "User-Agent": "Mozilla/5.0 UnabridgedAI", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`Search request failed (${response.status})`);
  return response.text();
};

const onionUrl = (value: string) => {
  const match = value.match(/https?:\/\/[a-z2-7]{16,56}\.onion[^\s"'<>]*/i);
  return match ? match[0].replace(/\/$/, "") : "";
};

export const webSearch = async (query: string): Promise<SearchHit[]> => {
  if (env.exaApiKey) {
    const response = await fetch("https://api.exa.ai/search", {
      method: "POST",
      signal: AbortSignal.timeout(8000),
      headers: { "Content-Type": "application/json", "x-api-key": env.exaApiKey },
      body: JSON.stringify({ query, numResults: 5, contents: { text: { maxCharacters: 500 } } }),
    });
    if (!response.ok) throw new Error("Web search failed");
    const data = (await response.json()) as { results?: Array<{ title?: string; url?: string; text?: string }> };
    return (data.results ?? [])
      .filter((item) => item.url)
      .map((item) => ({
        title: item.title || item.url || "Result",
        url: item.url as string,
        snippet: (item.text ?? "").slice(0, 400),
        kind: "web" as const,
      }));
  }

  const html = await fetchText("https://html.duckduckgo.com/html/", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `q=${encodeURIComponent(query)}`,
  });
  const hits: SearchHit[] = [];
  const pattern = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && hits.length < 5) {
    const rawUrl = decodeEntities(match[1]);
    const parsed = new URL(rawUrl, "https://duckduckgo.com");
    const url = parsed.searchParams.get("uddg") ?? parsed.toString();
    hits.push({ title: decodeEntities(match[2]) || url, url, snippet: decodeEntities(match[3]).slice(0, 400), kind: "web" });
  }
  return hits;
};

const ahmiaHtmlSearch = async (query: string): Promise<SearchHit[]> => {
  const home = await fetchText("https://ahmia.fi/", {}, 8000);
  const token = home.match(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]+)"/i);
  const params = new URLSearchParams({ q: query });
  if (token) params.set(token[1], token[2]);
  const html = await fetchText(`https://ahmia.fi/search/?${params.toString()}`, { headers: { Referer: "https://ahmia.fi/" } }, 15000);
  const hits: SearchHit[] = [];
  const resultPattern = /<li[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/li>/gi;
  let block: RegExpExecArray | null;
  while ((block = resultPattern.exec(html)) && hits.length < 5) {
    const href = block[1].match(/href="([^"]+)"/i)?.[1] ?? "";
    const parsed = new URL(decodeEntities(href), "https://ahmia.fi/");
    const url = onionUrl(parsed.searchParams.get("redirect_url") ?? parsed.toString());
    if (!url) continue;
    const title = decodeEntities(block[1].match(/<h4[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? url);
    const snippet = decodeEntities(block[1].match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] ?? "Publicly indexed Tor hidden service.");
    hits.push({ title, url, snippet: snippet.slice(0, 400), kind: "darkweb" });
  }
  return hits;
};

const ahmiaDirectorySearch = async (query: string): Promise<SearchHit[]> => {
  const text = await fetchText("https://ahmia.fi/onions/", {}, 12000);
  const terms = query.toLowerCase().split(/\s+/).filter((term) => term.length > 1);
  const urls = [...new Set(text.match(/https?:\/\/[a-z2-7]{16,56}\.onion/gi) ?? [])];
  const ranked = urls
    .map((url) => {
      const host = url.replace(/^https?:\/\//, "").toLowerCase();
      const score = terms.reduce((sum, term) => sum + (host.includes(term) ? 2 : 0), 0);
      return { url, host, score };
    })
    .filter((item) => item.score > 0 || terms.length === 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return ranked.map((item) => ({
    title: item.host,
    url: item.url,
    snippet: "Match from Ahmia’s public onion directory. OSINT only.",
    kind: "darkweb",
  }));
};

export const darkWebSearch = async (query: string): Promise<SearchHit[]> => {
  try {
    const hits = await ahmiaHtmlSearch(query);
    if (hits.length) return hits;
  } catch {
    // Ahmia HTML search is often gated or slow from clearnet.
  }
  return ahmiaDirectorySearch(query);
};

export const collectSources = async (query: string, useWeb: boolean, useDarkWeb: boolean) => {
  const sources: SearchHit[] = [];
  const tasks: Array<Promise<void>> = [];
  if (useWeb) {
    tasks.push(
      webSearch(query)
        .then((hits) => {
          sources.push(...hits);
        })
        .catch(() => undefined),
    );
  }
  if (useDarkWeb) {
    tasks.push(
      darkWebSearch(query)
        .then((hits) => {
          sources.push(...hits);
        })
        .catch(() => undefined),
    );
  }
  await Promise.all(tasks);
  return sources;
};
