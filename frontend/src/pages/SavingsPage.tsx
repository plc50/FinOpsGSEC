import { useMemo, useState } from 'react';
import type { EChartsOption } from 'echarts';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/states';
import { Badge } from '@/components/ui/Badge';
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable';
import { BaseChart } from '@/components/charts/BaseChart';
import { areaGradient } from '@/lib/echarts';
import { SIGNAL } from '@/lib/signals';
import { useMe } from '@/auth/AuthContext';
import { useSavings } from '@/api/queries';
import {
  formatCurrency,
  formatInt,
  formatLatency,
  formatPercent,
  humanizeEnum,
} from '@/lib/format';
import type {
  SavingsConsumerRow,
  SavingsMechanism,
  SavingsMechanismKey,
  SavingsResponse,
} from '@/api/types';

const RANGE_OPTIONS = [
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '90 days', days: 90 },
] as const;

/** Stable palette per mechanism so chart, donut and cards always match. */
const MECHANISM_COLORS: Record<SavingsMechanismKey, string> = {
  smart_routing: SIGNAL.accent,
  semantic_cache: SIGNAL.green,
  budget_degradation: SIGNAL.amber,
  category_downgrade: '#7c3aed',
  token_reduction: '#0e9db8',
};

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

export function SavingsPage() {
  const me = useMe();
  const [days, setDays] = useState<number>(30);
  const query = useSavings({ start_date: isoDaysAgo(days) });

  return (
    <div>
      <PageHeader
        title="Savings"
        description="What the proxy saved versus sending every request straight to a premium model."
        actions={
          <div className="flex items-center gap-1">
            {RANGE_OPTIONS.map((opt) => (
              <button
                key={opt.days}
                type="button"
                onClick={() => setDays(opt.days)}
                className={
                  days === opt.days
                    ? 'rounded-md border border-accent bg-accent/10 px-2.5 py-1 text-xs font-medium text-accent'
                    : 'rounded-md border border-line bg-surface px-2.5 py-1 text-xs text-text-secondary hover:border-line-strong'
                }
              >
                {opt.label}
              </button>
            ))}
          </div>
        }
      />

      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        data={query.data}
        loading={<Skeleton height={420} />}
        errorTitle="Unable to load savings"
      >
        {(d) => (
          <div className="space-y-4">
            <HeroStats data={d} />

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
              <Card className="xl:col-span-2">
                <CardHeader
                  title="Savings over time"
                  actions={
                    <span className="text-[11px] text-text-muted">
                      stacked by mechanism, per day
                    </span>
                  }
                />
                <CardBody>
                  <SavingsAreaChart data={d} />
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Where savings come from" />
                <CardBody>
                  <MechanismDonut data={d} />
                </CardBody>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {d.mechanisms.map((m) => (
                <MechanismCard key={m.mechanism} mechanism={m} currency={d.currency} />
              ))}
            </div>

            {me.role === 'admin' && d.consumers.length > 0 ? (
              <Card>
                <CardHeader title="Savings by consumer" />
                <CardBody>
                  <ResponsiveTable<SavingsConsumerRow>
                    columns={consumerCols}
                    rows={d.consumers}
                    getRowKey={(r) => r.consumer}
                    emptyMessage="No savings recorded."
                  />
                </CardBody>
              </Card>
            ) : null}

            <Methodology data={d} />
          </div>
        )}
      </QueryState>
    </div>
  );
}

function HeroStats({ data }: { data: SavingsResponse }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      <StatCard
        label="Total saved"
        tone="green"
        value={formatCurrency(data.total_savings, data.currency)}
        sub={`${formatInt(data.requests_analyzed)} requests analyzed`}
      />
      <StatCard
        label="Actual spend"
        value={formatCurrency(data.actual_spend, data.currency)}
        sub="what teams were charged"
      />
      <StatCard
        label="Without the proxy"
        value={formatCurrency(data.baseline_spend, data.currency)}
        sub="baseline: premium model, no cache"
      />
      <StatCard
        label="Cost reduction"
        tone="green"
        value={formatPercent(data.savings_ratio)}
        sub="vs the no-proxy baseline"
      />
      <StatCard
        label="Monthly run-rate"
        tone="green"
        value={formatCurrency(data.projected_monthly_savings, data.currency)}
        sub="savings projected over 30 days"
      />
    </div>
  );
}

function SavingsAreaChart({ data }: { data: SavingsResponse }) {
  const option = useMemo<EChartsOption>(() => {
    const dates = data.series.map((p) => p.date);
    const series = data.mechanisms
      .filter((m) => m.savings > 0)
      .map((m) => ({
        name: m.label,
        type: 'line' as const,
        stack: 'savings',
        showSymbol: false,
        color: MECHANISM_COLORS[m.mechanism],
        areaStyle: { opacity: 1, color: areaGradient(MECHANISM_COLORS[m.mechanism], 0.35, 0.05) },
        lineStyle: { width: 1.5 },
        emphasis: { focus: 'series' as const },
        data: data.series.map((p) => Number(p[m.mechanism].toFixed(6))),
      }));
    return {
      tooltip: {
        trigger: 'axis',
        valueFormatter: (v) => formatCurrency(Number(v), data.currency),
      },
      legend: { top: 0 },
      grid: { top: 32, left: 8, right: 12, bottom: 8, containLabel: true },
      xAxis: { type: 'category', data: dates, boundaryGap: false },
      yAxis: {
        type: 'value',
        axisLabel: { formatter: (v: number) => formatCurrency(v, data.currency) },
      },
      series,
    };
  }, [data]);

  if (data.series.length === 0) {
    return (
      <p className="py-16 text-center text-sm text-text-muted">
        No savings recorded in this period yet.
      </p>
    );
  }
  return <BaseChart option={option} height={300} ariaLabel="Savings over time by mechanism" />;
}

function MechanismDonut({ data }: { data: SavingsResponse }) {
  const option = useMemo<EChartsOption>(() => {
    const items = data.mechanisms
      .filter((m) => m.savings > 0)
      .map((m) => ({
        name: m.label,
        value: Number(m.savings.toFixed(6)),
        itemStyle: { color: MECHANISM_COLORS[m.mechanism] },
      }));
    return {
      tooltip: {
        trigger: 'item',
        valueFormatter: (v) => formatCurrency(Number(v), data.currency),
      },
      legend: { bottom: 0, left: 'center' },
      series: [
        {
          type: 'pie',
          radius: ['52%', '76%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          itemStyle: { borderColor: SIGNAL.surface, borderWidth: 2 },
          label: { show: false },
          emphasis: {
            label: { show: true, fontSize: 13, fontWeight: 600 },
          },
          data: items,
        },
      ],
    };
  }, [data]);

  if (data.total_savings <= 0) {
    return (
      <p className="py-16 text-center text-sm text-text-muted">
        No savings recorded in this period yet.
      </p>
    );
  }
  return <BaseChart option={option} height={300} ariaLabel="Savings share by mechanism" />;
}

function MechanismCard({
  mechanism,
  currency,
}: {
  mechanism: SavingsMechanism;
  currency: string;
}) {
  const { extra } = mechanism;
  return (
    <div className="flex min-h-[120px] flex-col justify-between rounded-lg border border-line bg-surface p-3 shadow-card">
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: MECHANISM_COLORS[mechanism.mechanism] }}
          />
          {mechanism.label}
        </span>
        <Badge tone={mechanism.kind === 'measured' ? 'green' : 'amber'}>
          {mechanism.kind}
        </Badge>
      </div>
      <span className="mt-1 text-xl font-semibold leading-none tracking-tight tabular text-text">
        {formatCurrency(mechanism.savings, currency)}
      </span>
      <div className="mt-1 space-y-0.5 text-[11px] text-text-muted">
        <p>
          {formatInt(mechanism.requests)} requests ·{' '}
          {formatPercent(mechanism.share)} of savings
        </p>
        {mechanism.mechanism === 'semantic_cache' && extra.hits ? (
          <p>
            served in {formatLatency(extra.avg_hit_latency_ms)} vs{' '}
            {formatLatency(extra.avg_provider_latency_ms)} at the provider
          </p>
        ) : null}
        {mechanism.mechanism === 'token_reduction' && extra.tokens_saved ? (
          <p>{formatInt(extra.tokens_saved)} context tokens not sent</p>
        ) : null}
      </div>
    </div>
  );
}

function Methodology({ data }: { data: SavingsResponse }) {
  return (
    <Card>
      <CardHeader
        title="How these numbers are computed"
        actions={
          <div className="flex items-center gap-1.5">
            <Badge tone="green">measured</Badge>
            <Badge tone="amber">estimated</Badge>
          </div>
        }
      />
      <CardBody>
        <ul className="space-y-1.5 text-xs text-text-secondary">
          {data.mechanisms.map((m) => (
            <li key={m.mechanism} className="flex items-start gap-2">
              <Badge tone={m.kind === 'measured' ? 'green' : 'amber'}>{m.kind}</Badge>
              <span>
                <span className="font-medium text-text">{m.label}:</span>{' '}
                {m.description}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[11px] text-text-muted">
          Measured savings come from audited per-request data priced with the
          model catalog. Estimated savings state their counterfactual explicitly
          and are kept separate so the deterministic figures stay defensible.
        </p>
      </CardBody>
    </Card>
  );
}

const consumerCols: Column<SavingsConsumerRow>[] = [
  { key: 'consumer', header: 'Consumer', render: (r) => r.consumer },
  {
    key: 'actual_spend',
    header: 'Actual spend',
    align: 'right',
    render: (r) => formatCurrency(r.actual_spend),
  },
  {
    key: 'savings',
    header: 'Saved',
    align: 'right',
    render: (r) => (
      <span className="font-medium text-signal-green">
        {formatCurrency(r.savings)}
      </span>
    ),
  },
  {
    key: 'savings_ratio',
    header: 'Cost reduction',
    align: 'right',
    render: (r) => formatPercent(r.savings_ratio),
  },
  {
    key: 'top_mechanism',
    header: 'Top mechanism',
    render: (r) =>
      r.top_mechanism ? (
        <span className="flex items-center gap-1.5 text-xs">
          <span
            className="inline-block h-2 w-2 rounded-full"
            style={{ backgroundColor: MECHANISM_COLORS[r.top_mechanism] }}
          />
          {humanizeEnum(r.top_mechanism)}
        </span>
      ) : (
        '—'
      ),
  },
];
