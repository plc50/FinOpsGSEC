import type { AuditRow } from '@/api/types';
import { formatCurrency, formatInt, formatLatency } from '@/lib/format';

function cacheLabel(row: AuditRow) {
  return row.status === 'semantic_cache_hit' || row.usage_source === 'semantic_cache'
    ? 'HIT'
    : 'MISS';
}

export function RoutingDecision({ audit }: { audit: AuditRow }) {
  const metrics = [
    ['Category', audit.category],
    ['Tier', audit.complexity_tier],
    ['Provider', audit.selected_provider],
    ['Model', audit.selected_model],
    ['Input tokens', formatInt(audit.actual_prompt_tokens)],
    ['Output tokens', formatInt(audit.actual_output_tokens)],
    ['Actual cost', formatCurrency(audit.actual_model_cost)],
    ['Baseline', formatCurrency(audit.baseline_model_cost)],
    ['Savings', formatCurrency(audit.estimated_savings)],
    ['Latency', formatLatency(audit.latency_ms)],
    ['HTTP / status', audit.error_code ? `error · ${audit.error_code}` : '2xx'],
    ['Budget', audit.budget_action],
    ['Cache', cacheLabel(audit)],
  ];

  return (
    <div className="pitch-routing-result" aria-label="Audited routing decision">
      <div className="pitch-path" aria-label="Request path">
        <span className="is-complete">App</span>
        <i>→</i>
        <span className="is-complete">Classify</span>
        <i>→</i>
        <span className="is-complete">Policy</span>
        <i>→</i>
        <span className="is-selected">{audit.selected_provider}</span>
      </div>
      <dl className="pitch-metric-grid">
        {metrics.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={String(value ?? '')}>{value ?? '—'}</dd>
          </div>
        ))}
      </dl>
      <p className="pitch-audit-proof">
        Audited record <code>{audit.id}</code>
      </p>
    </div>
  );
}
