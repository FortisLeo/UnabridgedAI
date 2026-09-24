import { useEffect, useState } from "react";
import { ApiPage } from "../features/api/ApiPage.tsx";
import { DocsPage } from "../features/api/DocsPage.tsx";
import { AuthScreen } from "../features/auth/AuthScreen.tsx";
import { BillingPage } from "../features/billing/BillingPage.tsx";
import { ChatView } from "../features/chat/ChatView.tsx";
import { SettingsPage } from "../features/settings/SettingsPage.tsx";
import { Sidebar } from "../features/shell/Sidebar.tsx";
import { api } from "../lib/api.ts";
import { defaultSettings, type ChatSummary, type Message, type Quota, type Settings, type User, type View } from "../types.ts";

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [chats, setChats] = useState<ChatSummary[]>([]);
  const [activeChatId, setActiveChatId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [view, setView] = useState<View>("chat");
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<Quota | null>(null);

  const loadChats = async () => {
    const data = await api<{ chats: ChatSummary[] }>("/api/chats");
    setChats(data.chats);
  };

  useEffect(() => {
    api<{ user: User; settings: Settings; quota?: Quota }>("/api/me")
      .then(async (data) => {
        setUser(data.user);
        setSettings({ ...defaultSettings, ...data.settings });
        if (data.quota) setQuota(data.quota);
        await loadChats();
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const openChat = async (id: string | null) => {
    setView("chat");
    setActiveChatId(id);
    if (!id) {
      setMessages([]);
      return;
    }
    const data = await api<{ messages: Message[] }>(`/api/chats/${id}`);
    setMessages(data.messages);
  };

  const titles: Record<View, string> = {
    chat: activeChatId ? chats.find((chat) => chat.id === activeChatId)?.title ?? "Open channel" : "New session",
    settings: "Control plane",
    billing: "Access plan",
    api: "Get API",
    docs: "API docs",
  };

  if (loading) return <div className="boot"><span className="sigil">UnabridgedAI</span><span>initializing private channel</span></div>;
  if (!user) return <AuthScreen mode={authMode} setMode={setAuthMode} onAuth={(next, nextQuota) => { setUser(next); if (nextQuota) setQuota(nextQuota); }} error={error} setError={setError} />;

  return (
    <div className={`app theme-${settings.theme}`}>
      <Sidebar
        chats={chats}
        activeChatId={activeChatId}
        view={view}
        onNewSession={() => openChat(null)}
        onOpenChat={(id) => openChat(id)}
        onChangeView={setView}
      />
      <main>
        <header>
          <div>
            <div className="eyebrow">workspace / {user.username}{quota?.plan === "free" && quota.remaining !== null ? ` · ${quota.remaining} free left` : quota?.plan === "pro" ? " · pro" : ""}</div>
            <h1>{titles[view]}</h1>
          </div>
          {view === "chat" && (
            <button
              className={`temp-icon ${settings.temporaryChat ? "on" : ""}`}
              title={settings.temporaryChat ? "Temporary chat on — this session will not be saved" : "Temporary chat off"}
              aria-label="Temporary chat"
              onClick={async () => {
                const data = await api<{ settings: Settings }>("/api/settings", { method: "PUT", body: JSON.stringify({ temporaryChat: !settings.temporaryChat }) });
                setSettings({ ...defaultSettings, ...data.settings });
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />
                <path d="M12 8v5l3 2" />
              </svg>
            </button>
          )}
          {view === "api" && <button className="header-link" onClick={() => setView("docs")}>docs ↗</button>}
          {view === "docs" && <button className="header-link" onClick={() => setView("api")}>keys ↗</button>}
        </header>
        {view === "chat" ? (
          <ChatView
            chatId={activeChatId}
            messages={messages}
            setMessages={setMessages}
            settings={settings}
            setSettings={setSettings}
            quota={quota}
            onQuota={setQuota}
            onUpgrade={() => setView("billing")}
            onChatSaved={async (chat) => {
              setActiveChatId(chat.id);
              await loadChats();
            }}
          />
        ) : view === "settings" ? (
          <SettingsPage
            settings={settings}
            setSettings={setSettings}
            onHistoryCleared={async () => {
              setChats([]);
              setActiveChatId(null);
              setMessages([]);
            }}
          />
        ) : view === "api" ? (
          <ApiPage />
        ) : view === "docs" ? (
          <DocsPage />
        ) : (
          <BillingPage onQuota={setQuota} />
        )}
      </main>
    </div>
  );
}
