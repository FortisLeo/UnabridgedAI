import { useEffect, useRef, useState } from "react";
import { ApiError, api } from "../../lib/api.ts";
import { Markdown } from "../../lib/markdown.tsx";
import { defaultSettings, type ChatSummary, type Message, type Quota, type Settings } from "../../types.ts";
import { Paywall } from "../billing/Paywall.tsx";

export function ChatView({
  chatId,
  messages,
  setMessages,
  settings,
  setSettings,
  quota,
  onQuota,
  onUpgrade,
  onChatSaved,
}: {
  chatId: string | null;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  quota: Quota | null;
  onQuota: (quota: Quota) => void;
  onUpgrade: () => void;
  onChatSaved: (chat: ChatSummary) => Promise<void>;
}) {
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [webSearch, setWebSearch] = useState(settings.webSearch);
  const [darkWebSearch, setDarkWebSearch] = useState(settings.darkWebSearch);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setWebSearch(settings.webSearch);
    setDarkWebSearch(settings.darkWebSearch);
  }, [settings.webSearch, settings.darkWebSearch]);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight });
  }, [messages, busy]);

  const persistToggles = async (next: { webSearch?: boolean; darkWebSearch?: boolean }) => {
    const data = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: JSON.stringify(next) });
    setSettings({ ...defaultSettings, ...data.settings });
  };

  const send = async () => {
    if (!input.trim() || busy || (quota?.plan === "free" && quota.remaining === 0)) return;
    const content = input.trim();
    setInput("");
    setMessages((current) => [...current, { role: "user", content }, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chatId: chatId || undefined, content, webSearch, darkWebSearch }),
      });
      if (response.status === 402) {
        const payload = await response.json().catch(() => ({}));
        throw new ApiError(payload.error ?? "Free limit reached. Upgrade to Pro to keep chatting.", 402, payload);
      }
      if (!response.ok || !response.body) throw new Error("The channel dropped before a reply came back.");

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let reply = "";
      let sources: Message["sources"] = [];

      const applyReply = (next: string, nextSources?: Message["sources"]) => {
        reply = next;
        setMessages((current) => {
          const copy = [...current];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant") copy[copy.length - 1] = { ...last, content: next, sources: nextSources ?? last.sources };
          return copy;
        });
      };

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          const event = frame.match(/^event: (.+)$/m)?.[1];
          const dataLine = frame.match(/^data: (.+)$/m)?.[1];
          if (!event || !dataLine) continue;
          const data = JSON.parse(dataLine);
          if (event === "delta" && typeof data.text === "string") applyReply(reply + data.text);
          if (event === "sources" && Array.isArray(data.sources)) {
            sources = data.sources;
            applyReply(reply, sources);
          }
          if (event === "done") {
            if (Array.isArray(data.sources)) sources = data.sources;
            if (typeof data.reply === "string") applyReply(data.reply, sources);
            else applyReply(reply, sources);
            if (data.quota) onQuota(data.quota);
            if (data.chat) await onChatSaved(data.chat);
          }
          if (event === "error") throw new Error(data.error ?? "UnabridgedAI is unavailable right now.");
        }
      }
    } catch (error) {
      if (error instanceof ApiError && (error.status === 402 || error.code === "PAYWALL")) {
        const next = error.payload.quota as Quota | undefined;
        if (next) onQuota(next);
        onUpgrade();
        setMessages((current) => {
          const copy = [...current];
          copy[copy.length - 1] = { role: "assistant", content: "Free limit reached. Upgrade to Pro to keep chatting." };
          return copy;
        });
      } else {
        setMessages((current) => {
          const copy = [...current];
          const last = copy[copy.length - 1];
          if (last?.role === "assistant" && !last.content) {
            copy[copy.length - 1] = { role: "assistant", content: `channel error: ${(error as Error).message}` };
          } else {
            copy.push({ role: "assistant", content: `channel error: ${(error as Error).message}` });
          }
          return copy;
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="chat">
      <div className="conversation" ref={scroller}>
        {messages.length === 0 ? (
          <div className="empty">
            <div className="empty-number">n4</div>
            <h2>Say what you mean.</h2>
            <p>Sessions persist in the left panel. Search is optional, memory is yours, and nothing is filtered unless you ask it to be.</p>
            <div className="suggestions">
              <button onClick={() => setInput("Help me examine an idea from an angle I have not considered.")}>examine an idea <span>↗</span></button>
              <button onClick={() => setInput("Search current sources and tell me what actually changed.")}>search the edge <span>↗</span></button>
            </div>
          </div>
        ) : messages.map((message, index) => (
          <div className={`message ${message.role}${busy && index === messages.length - 1 && message.role === "assistant" ? " streaming" : ""}`} key={message.id ?? index}>
            <div className="message-label">{message.role === "user" ? "you" : "UnabridgedAI"}</div>
            {message.sources && message.sources.length > 0 && (
              <div className="sources">
                {message.sources.map((source) => (
                  <a key={source.url} className={source.kind} href={source.url} target="_blank" rel="noreferrer" title={source.title}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="7" />
                      <path d="M20 20l-3.5-3.5" />
                    </svg>
                    <strong>{source.title || source.url}</strong>
                  </a>
                ))}
              </div>
            )}
            {message.role === "assistant" ? (
              message.content ? <Markdown text={message.content} /> : <div className="typing"><i /><i /><i /></div>
            ) : <div className="user-text">{message.content}</div>}
          </div>
        ))}
        {quota?.plan === "free" && quota.remaining === 0 && <Paywall remaining={quota.remaining} onUpgrade={onUpgrade} />}
      </div>
      <div className="composer">
        <div className="toggles">
          <button
            className={webSearch ? "on" : ""}
            onClick={() => {
              const next = !webSearch;
              setWebSearch(next);
              persistToggles({ webSearch: next }).catch(() => {});
            }}
          >web search</button>
          <button
            className={darkWebSearch ? "on dark" : ""}
            onClick={() => {
              const next = !darkWebSearch;
              setDarkWebSearch(next);
              persistToggles({ darkWebSearch: next }).catch(() => {});
            }}
          >dark web search</button>
        </div>
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder={quota?.plan === "free" && quota.remaining === 0 ? "Free limit reached. Upgrade to keep chatting." : "Drop a thought here..."}
          rows={2}
          disabled={quota?.plan === "free" && quota.remaining === 0}
        />
        <button className="send" onClick={send} aria-label="Send message" disabled={quota?.plan === "free" && quota.remaining === 0}>↗</button>
      </div>
    </section>
  );
}
