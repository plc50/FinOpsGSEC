import { Select } from './controls';

/**
 * Admin consumer scope selector. Options come from visible_consumers
 * (from /dashboard/me) — the frontend never invents consumers (§3/§11).
 */
export function ConsumerSelect({
  value,
  onChange,
  consumers,
  allowAll = true,
  allLabel = 'All consumers (global)',
  id,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  consumers: string[];
  allowAll?: boolean;
  allLabel?: string;
  id?: string;
}) {
  return (
    <Select
      id={id}
      value={value ?? '__all__'}
      onChange={(e) =>
        onChange(e.target.value === '__all__' ? null : e.target.value)
      }
      className="w-auto min-w-44"
      aria-label="Consumer scope"
    >
      {allowAll ? <option value="__all__">{allLabel}</option> : null}
      {consumers.map((c) => (
        <option key={c} value={c}>
          {c}
        </option>
      ))}
    </Select>
  );
}
