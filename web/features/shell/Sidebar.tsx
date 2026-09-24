import { api } from "../../lib/api.ts";
import { timeAgo } from "../../lib/time.ts";
import type { ChatSummary, View } from "../../types.ts";

export function Sidebar({
  chats,
  activeChatId,
  view,
  onNewSession,
  onOpenChat,
  onChangeView,
}: {
  chats: ChatSummary[];
  activeChatId: string | null;
  view: View;
  onNewSession: () => void;
  onOpenChat: (id: string) => void;
  onChangeView: (view: View) => void;
}) {
  return (
    <aside>
      <div className="brand"><span className="brand-mark">UA</span><span>UnabridgedAI</span></div>
      <button className="new-session" onClick={onNewSession}>↗ New session</button>
      <div className="status"><i /> private mode <small>v0.2</small></div>
      <div className="chat-list-label">sessions</div>
      <div className="chat-list">
        {chats.length === 0 ? (
          <div className="empty-chats">no saved sessions yet</div>
        ) : chats.map((chat) => (
          <button key={chat.id} className={chat.id === activeChatId && view === "chat" ? "active" : ""} onClick={() => onOpenChat(chat.id)}>
            <strong>{chat.title}</strong>
            <small>{timeAgo(chat.updated_at)}</small>
          </button>
        ))}
      </div>
      <nav>
        <button className={view === "settings" ? "active" : ""} onClick={() => onChangeView("settings")}><span>⚙</span> Settings</button>
        <button className={view === "billing" ? "active" : ""} onClick={() => onChangeView("billing")}><span>◈</span> Billing</button>
        <button className={view === "api" ? "active" : ""} onClick={() => onChangeView("api")}><span>⌘</span> Get API</button>
      </nav>
      <div className="side-note">history stays on your account.<br />search is opt-in per message.</div>
      <button className="signout" onClick={async () => { await api("/api/auth/signout", { method: "POST" }); location.reload(); }}>sign out <span>↘</span></button>
    </aside>
  );
}
