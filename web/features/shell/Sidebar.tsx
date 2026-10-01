import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/time.ts";
import type { ChatSummary, View } from "../../types.ts";

type MenuState = { chat: ChatSummary; x: number; y: number };

export function Sidebar({
  chats,
  activeChatId,
  view,
  onNewSession,
  onOpenChat,
  onChangeView,
  onChatsChange,
  onChatRemoved,
}: {
  chats: ChatSummary[];
  activeChatId: string | null;
  view: View;
  onNewSession: () => void;
  onOpenChat: (id: string) => void;
  onChangeView: (view: View) => void;
  onChatsChange?: (update: (chats: ChatSummary[]) => ChatSummary[]) => void;
  onChatRemoved?: (id: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ChatSummary | null>(null);
  const [actionError, setActionError] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return chats;
    return chats.filter((chat) => chat.title.toLowerCase().includes(needle));
  }, [chats, query]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      setMenu(null);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  const openMenu = (chat: ChatSummary, event: React.MouseEvent) => {
    event.preventDefault();
    const menuWidth = 180;
    const menuHeight = 132;
    const x = Math.min(event.clientX, window.innerWidth - menuWidth - 8);
    const y = Math.min(event.clientY, window.innerHeight - menuHeight - 8);
    setActionError("");
    setMenu({ chat, x: Math.max(8, x), y: Math.max(8, y) });
  };

  const pinChat = async (chat: ChatSummary) => {
    setMenu(null);
    setActionError("");
    const pinned = chat.pinned ? 0 : 1;
    const data = await api<{ chat: ChatSummary }>(`/api/chats/${chat.id}`, {
      method: "PATCH",
      body: JSON.stringify({ pinned: Boolean(pinned) }),
    });
    const next = data.chat ?? { ...chat, pinned };
    onChatsChange?.((items) =>
      items
        .map((item) => (item.id === chat.id ? { ...item, ...next } : item))
        .sort((a, b) => Number(b.pinned ?? 0) - Number(a.pinned ?? 0) || b.updated_at - a.updated_at),
    );
  };

  const focusSearch = () => {
    setMenu(null);
    setQuery(menu?.chat.title ?? "");
    searchRef.current?.focus();
  };

  const removeChat = async (chat: ChatSummary) => {
    setActionError("");
    await api(`/api/chats/${chat.id}`, { method: "DELETE" });
    onChatsChange?.((items) => items.filter((item) => item.id !== chat.id));
    onChatRemoved?.(chat.id);
    setPendingDelete(null);
  };

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <>
      <button
        className={`menu-trigger ${drawerOpen ? "is-open" : ""}`}
        onClick={() => setDrawerOpen((open) => !open)}
        aria-label={drawerOpen ? "Close menu" : "Open menu"}
        aria-expanded={drawerOpen}
      >
        <span /><span /><span />
      </button>
      {drawerOpen && <button className="menu-backdrop" aria-label="Close menu" onClick={closeDrawer} />}
      <aside className={drawerOpen ? "drawer-open" : ""}>
      <div className="brand"><span className="brand-mark">UA</span><span>UnabridgedAI</span></div>
      <button className="new-session" onClick={() => { closeDrawer(); onNewSession(); }}>↗ New session</button>
      <div className="status"><i /> private mode <small>v0.2</small></div>
      <label className="session-search">
        <span className="chat-list-label">search sessions</span>
        <input
          ref={searchRef}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter saved sessions"
          aria-label="Search sessions"
        />
      </label>
      <div className="chat-list-label">sessions</div>
      <div className="chat-list" role="list">
        {chats.length === 0 ? (
          <div className="empty-chats">no saved sessions yet</div>
        ) : visible.length === 0 ? (
          <div className="empty-chats">no sessions match</div>
        ) : visible.map((chat) => (
          <button
            key={chat.id}
            role="listitem"
            className={chat.id === activeChatId && view === "chat" ? "active" : ""}
            aria-current={chat.id === activeChatId && view === "chat" ? "true" : undefined}
            aria-haspopup="menu"
            onClick={() => { closeDrawer(); onOpenChat(chat.id); }}
            onContextMenu={(event) => openMenu(chat, event)}
          >
            <strong>{chat.pinned ? "📌 " : ""}{chat.title}</strong>
            <small>{timeAgo(chat.updated_at)}</small>
          </button>
        ))}
      </div>
      {actionError && <div className="error session-error">{actionError}</div>}
      {menu && (
        <div
          ref={menuRef}
          className="session-menu"
          role="menu"
          aria-label={`Actions for ${menu.chat.title}`}
          style={{ left: menu.x, top: menu.y }}
        >
          <button role="menuitem" onClick={() => pinChat(menu.chat).catch((err: Error) => setActionError(err.message))}>
            {menu.chat.pinned ? "Unpin" : "Pin"}
          </button>
          <button role="menuitem" onClick={focusSearch}>Search</button>
          <button role="menuitem" className="danger-item" onClick={() => { setPendingDelete(menu.chat); setMenu(null); }}>Delete</button>
        </div>
      )}
      {pendingDelete && (
        <div className="confirm-layer" role="dialog" aria-modal="true" aria-labelledby="delete-session-title">
          <div className="confirm-card">
            <div className="eyebrow">delete session</div>
            <h2 id="delete-session-title">Delete “{pendingDelete.title}”?</h2>
            <p>This removes the session from your account. It cannot be undone.</p>
            <div className="row-actions">
              <button className="secondary" onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="danger" onClick={() => removeChat(pendingDelete).catch((err: Error) => { setActionError(err.message); setPendingDelete(null); })}>Delete</button>
            </div>
          </div>
        </div>
      )}
      <div className="side-note">history stays on your account.<br />search is opt-in per message.</div>
      <div className="sidebar-bottom">
        <nav>
          <button className={view === "settings" ? "active" : ""} onClick={() => { closeDrawer(); onChangeView("settings"); }}><span>⚙</span> Settings</button>
          <button className={view === "billing" ? "active" : ""} onClick={() => { closeDrawer(); onChangeView("billing"); }}><span>◈</span> Billing</button>
          <button className={view === "api" ? "active" : ""} onClick={() => { closeDrawer(); onChangeView("api"); }}><span>⌘</span> Get API</button>
        </nav>
        <button className="signout" onClick={async () => { await api("/api/auth/signout", { method: "POST" }); location.reload(); }} title="Signs out the current session">sign out <span>↘</span></button>
      </div>
    </aside>
    </>
  );
}
