export function Paywall({ onUpgrade }: { remaining?: number | null; onUpgrade: () => void }) {
  return (
    <div className="paywall">
      <div className="eyebrow">free channel closed</div>
      <h2>You've used the 10 free requests.</h2>
      <p>This account has reached the free limit. New accounts from the same network won’t reset it. Purchases are currently disabled.</p>
      <button className="primary" onClick={onUpgrade}>view plan ↗</button>
    </div>
  );
}
