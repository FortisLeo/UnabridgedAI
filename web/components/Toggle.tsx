export function Toggle({
  label,
  hint,
  on,
  onChange,
}: {
  label: string;
  hint: string;
  on: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button className={`toggle ${on ? "on" : ""}`} onClick={() => onChange(!on)}>
      <div>
        <strong>{label}</strong>
        <small>{hint}</small>
      </div>
      <i />
    </button>
  );
}
