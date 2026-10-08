import type { ReactNode } from "react";

export function Panel({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return (
    <section className={`admin-panel ${className}`.trim()}>
      <div className="eyebrow">{title}</div>
      {children}
    </section>
  );
}

export function Rows({ items }: { items: Array<{ label: string; value: ReactNode }> }) {
  return (
    <div className="admin-list">
      {items.map((item) => (
        <div className="admin-row" key={item.label}>
          <strong>{item.label}</strong>
          <span>{item.value}</span>
        </div>
      ))}
    </div>
  );
}

export type AdminEvent = { id: number; invoice_id: string; at: number; kind: string; detail: string };

export function Events({ events }: { events: AdminEvent[] }) {
  if (!events.length) return <p className="muted">No payment events recorded.</p>;
  return (
    <div>
      {events.map((event) => (
        <div className="admin-event" key={event.id}>
          <span>{new Date(event.at).toLocaleString()}</span>
          <strong>{event.kind}</strong>
          <code>{event.invoice_id}</code>
          <small>{event.detail}</small>
        </div>
      ))}
    </div>
  );
}

export function Table({ rows, columns, scrollable = false }: { rows: Array<Record<string, unknown>>; columns: string[]; scrollable?: boolean }) {
  if (!rows.length) return <p className="muted">No records.</p>;
  return (
    <div className={`admin-table-wrap ${scrollable ? "admin-table-scroll" : ""}`}>
      <table className="admin-table">
        <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String(row.id ?? index)}>
              {columns.map((column) => <td key={column}>{String(row[column] ?? "-")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
