import type {
  BudgetAction,
  ForecastStatus,
  RequestStatus,
  Severity,
} from '@/api/types';

/** Raw signal token colors (mirrors index.css), used by ECharts and inline styles. */
export const SIGNAL = {
  green: '#0d9464',
  amber: '#c47b08',
  red: '#dc3a30',
  accent: '#3556e6',
  secondary: '#5b6779',
  muted: '#939dad',
  text: '#1a2333',
  line: '#e4e8ee',
  surface: '#ffffff',
} as const;

export type SignalTone = 'green' | 'amber' | 'red' | 'neutral';

/** Tailwind utility classes per tone for badges/tags (soft tinted pills). */
export const TONE_CLASSES: Record<SignalTone, string> = {
  green: 'text-signal-green border-signal-green/25 bg-signal-green-dim',
  amber: 'text-signal-amber border-signal-amber/25 bg-signal-amber-dim',
  red: 'text-signal-red border-signal-red/25 bg-signal-red-dim',
  neutral: 'text-text-secondary border-line bg-surface-raised',
};

export function forecastTone(status: ForecastStatus): SignalTone {
  switch (status) {
    case 'on_track':
      return 'green';
    case 'at_risk':
      return 'amber';
    case 'projected_over_budget':
      return 'red';
    default:
      return 'neutral';
  }
}

export function forecastColor(status: ForecastStatus): string {
  return toneColor(forecastTone(status));
}

export function severityTone(severity: Severity): SignalTone {
  switch (severity) {
    case 'info':
      return 'green';
    case 'warning':
      return 'amber';
    case 'critical':
      return 'red';
    default:
      return 'neutral';
  }
}

export function budgetActionTone(action: BudgetAction): SignalTone {
  switch (action) {
    case 'allow':
      return 'green';
    case 'warn_only':
      return 'amber';
    case 'degraded':
      return 'amber';
    case 'blocked':
      return 'red';
    default:
      return 'neutral';
  }
}

export function statusTone(status: RequestStatus): SignalTone {
  switch (status) {
    case 'completed':
    case 'semantic_cache_hit':
      return 'green';
    case 'warn_only':
      return 'amber';
    case 'degraded':
      return 'amber';
    case 'blocked':
      return 'red';
    case 'provider_error':
    case 'provider_stream_error':
      return 'red';
    case 'cancelled_by_client':
      return 'neutral';
    default:
      return 'neutral';
  }
}

/** Tone applied to budget-usage percentage relative to a warning threshold. */
export function budgetUsageTone(
  usedPct: number,
  warningThreshold = 0.8,
): SignalTone {
  if (usedPct >= 1) return 'red';
  if (usedPct >= warningThreshold) return 'amber';
  return 'green';
}

export function toneColor(tone: SignalTone): string {
  switch (tone) {
    case 'green':
      return SIGNAL.green;
    case 'amber':
      return SIGNAL.amber;
    case 'red':
      return SIGNAL.red;
    default:
      return SIGNAL.secondary;
  }
}
