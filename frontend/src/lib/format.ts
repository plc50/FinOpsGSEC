/**
 * Formatting helpers implementing FRONTEND_CONTEXT §9 exactly.
 * All numbers are rendered with tabular-nums via CSS; these helpers only
 * decide precision and units.
 */

/**
 * Currency (USD):
 *  - amount >= 1  -> "$12.34"  (2 decimals)
 *  - amount < 1   -> "$0.000041" (up to 6 significant decimals, trailing kept)
 */
export function formatCurrency(
  amount: number | null | undefined,
  currency = 'USD',
): string {
  if (amount === null || amount === undefined || Number.isNaN(amount)) {
    return '—';
  }
  const sign = amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  const symbol = currency === 'USD' ? '$' : `${currency} `;

  if (abs >= 1) {
    return `${sign}${symbol}${abs.toFixed(2)}`;
  }
  if (abs === 0) {
    return `${symbol}0.00`;
  }
  // Sub-dollar: show up to 6 decimals, trim trailing zeros but keep >= 2.
  let str = abs.toFixed(6);
  str = str.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  const [, decimals = ''] = str.split('.');
  if (decimals.length < 2) {
    str = abs.toFixed(2);
  }
  return `${sign}${symbol}${str}`;
}

/**
 * Percent: 0.84 -> "84%". Uses round to nearest integer by default,
 * optionally keeps one decimal for values that need precision (admin 0.4275).
 */
export function formatPercent(
  ratio: number | null | undefined,
  opts: { decimals?: number } = {},
): string {
  if (ratio === null || ratio === undefined || Number.isNaN(ratio)) {
    return '—';
  }
  const pct = ratio * 100;
  const decimals =
    opts.decimals ?? (Number.isInteger(pct) ? 0 : pct < 10 ? 1 : 0);
  return `${pct.toFixed(decimals)}%`;
}

/**
 * Latency:
 *  - >= 1000ms -> "1.84s"
 *  - < 1000ms  -> "450ms"
 */
export function formatLatency(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || Number.isNaN(ms)) return '—';
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`;
  }
  return `${Math.round(ms)}ms`;
}

/** Scores: 0.224 -> "0.22" (2 decimals). */
export function formatScore(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score)) return '—';
  return score.toFixed(2);
}

/** Local human time for display; keep ISO separately in detail views. */
export function formatLocalTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

/** Compact local time (no seconds) for dense tables. */
export function formatLocalTimeShort(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Local date only (for budget exhaustion date). */
export function formatLocalDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
  });
}

/** Plain integer with thousands separators (requests count, tokens). */
export function formatInt(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return Math.round(n).toLocaleString();
}

/** Human label from a snake_case enum, e.g. "projected_over_budget" -> "Projected over budget". */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '—';
  const spaced = value.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
