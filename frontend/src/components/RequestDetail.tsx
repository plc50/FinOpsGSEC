import type { ReactNode } from 'react';
import type { AuditRow } from '@/api/types';
import { Badge } from '@/components/ui/Badge';
import { ProviderChip } from '@/components/ui/ProviderIcon';
import { BudgetActionTag, StatusTag } from '@/components/ui/tags';
import {
  formatCurrency,
  formatInt,
  formatLatency,
  formatLocalTime,
  formatScore,
} from '@/lib/format';

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-3 py-1">
      <span className="text-[11px] uppercase tracking-wide text-text-secondary">
        {label}
      </span>
      <span className="text-right text-sm tabular">{children}</span>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0">
      <h4 className="mb-1 border-b border-line pb-1 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
        {title}
      </h4>
      <div className="divide-y divide-line/40">{children}</div>
    </div>
  );
}

/** Row detail panel (§7.3). Renders raw values only; no fabricated data. */
export function RequestDetail({ row }: { row: AuditRow }) {
  const isDegraded = row.budget_action === 'degraded';
  const isFailed =
    row.status === 'blocked' ||
    row.status === 'provider_error' ||
    row.status === 'provider_stream_error';

  return (
    <div className="grid grid-cols-1 gap-4 bg-surface-raised p-3 md:grid-cols-2 lg:grid-cols-3">
      <Section title="Tokens (estimated vs actual)">
        <Row label="Prompt est.">{formatInt(row.estimated_prompt_tokens)}</Row>
        <Row label="Prompt actual">{formatInt(row.actual_prompt_tokens)}</Row>
        <Row label="Output est.">{formatInt(row.estimated_output_tokens)}</Row>
        <Row label="Output actual">{formatInt(row.actual_output_tokens)}</Row>
        <Row label="Usage source">
          <Badge tone="neutral">{row.usage_source}</Badge>
        </Row>
      </Section>

      <Section title="Cost">
        <Row label="Est. model">{formatCurrency(row.estimated_model_cost)}</Row>
        <Row label="Actual model">{formatCurrency(row.actual_model_cost)}</Row>
        <Row label="Backend cost">{formatCurrency(row.backend_cost)}</Row>
        <Row label="Routing overhead">
          {formatCurrency(row.routing_overhead_cost)}
        </Row>
        <Row label="Budget charge">{formatCurrency(row.budget_charge)}</Row>
      </Section>

      <Section title="Routing & model">
        <Row label="Requested">{row.requested_model}</Row>
        <Row label="Provider">
          <ProviderChip provider={row.selected_provider} />
        </Row>
        <Row label="Selected">
          <span className="font-mono text-xs">{row.selected_model}</span>
        </Row>
        <Row label="Routing source">
          <Badge tone="neutral">{row.routing_source}</Badge>
        </Row>
        <Row label="Category">
          {row.original_category ? (
            <span className="inline-flex items-center gap-1">
              <span className="text-text-muted line-through">
                {row.original_category}
              </span>
              <span aria-hidden>&rarr;</span>
              <Badge tone="amber">{row.category} (policy)</Badge>
            </span>
          ) : (
            row.category
          )}
        </Row>
        <Row label="Complexity">
          {row.complexity_tier} · {formatScore(row.complexity_score)}
        </Row>
        <Row label="Action">
          <BudgetActionTag action={row.budget_action} />
        </Row>
        <Row label="Status">
          <StatusTag status={row.status} />
        </Row>
      </Section>

      {isDegraded ? (
        <Section title="Degradation savings">
          <Row label="Baseline model">
            <span className="font-mono text-xs">
              {row.baseline_model ?? '—'}
            </span>
          </Row>
          <Row label="Baseline cost">
            {formatCurrency(row.baseline_model_cost)}
          </Row>
          <Row label="Estimated savings">
            <span className="text-signal-amber">
              {formatCurrency(row.estimated_savings)}
            </span>
          </Row>
          <Row label="Savings ratio">
            {row.estimated_savings_ratio !== null
              ? `${Math.round(row.estimated_savings_ratio * 100)}%`
              : '—'}
          </Row>
        </Section>
      ) : null}

      <Section title="Capabilities & timing">
        <Row label="Capabilities">
          <span className="flex flex-wrap justify-end gap-1">
            {row.required_capabilities.map((c) => (
              <Badge key={c} tone="neutral">
                {c}
              </Badge>
            ))}
          </span>
        </Row>
        <Row label="Latency">{formatLatency(row.latency_ms)}</Row>
        <Row label="Stream">{row.stream ? 'yes' : 'no'}</Row>
        <Row label="Started">
          <span title={row.timestamp_started}>
            {formatLocalTime(row.timestamp_started)}
          </span>
        </Row>
        <Row label="Completed">
          <span title={row.timestamp_completed ?? undefined}>
            {formatLocalTime(row.timestamp_completed)}
          </span>
        </Row>
      </Section>

      <Section title="Prompt & diagnostics">
        <div className="py-1">
          <span className="text-[11px] uppercase tracking-wide text-text-secondary">
            Prompt preview
          </span>
          <p className="mt-1 break-words rounded-sm border border-line bg-bg p-2 text-xs text-text">
            {row.prompt_preview || '—'}
          </p>
        </div>
        {isFailed && row.error_code ? (
          <Row label="Error code">
            <span className="text-signal-red">{row.error_code}</span>
          </Row>
        ) : null}
        {row.budget_action_reason ? (
          <div className="py-1">
            <span className="text-[11px] uppercase tracking-wide text-text-secondary">
              Budget action reason
            </span>
            <p className="mt-1 text-xs text-text">{row.budget_action_reason}</p>
          </div>
        ) : null}
      </Section>
    </div>
  );
}
