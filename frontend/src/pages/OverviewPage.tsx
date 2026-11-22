import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState, EmptyState } from '@/components/ui/states';
import { ConsumerSelect } from '@/components/ui/ConsumerSelect';
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable';
import { ForecastChart } from '@/components/charts/ForecastChart';
import { SpendOverTimeChart } from '@/components/charts/SpendOverTimeChart';
import {
  BudgetActionTag,
  ForecastStatusTag,
  SeverityTag,
  StatusTag,
} from '@/components/ui/tags';
import { useMe } from '@/auth/AuthContext';
import {
  useAlerts,
  useConsumers,
  useForecast,
  useRequests,
  useSummary,
} from '@/api/queries';
import { useAggregateForecast } from '@/api/aggregate';
import {
  formatCurrency,
  formatInt,
  formatLatency,
  formatLocalTimeShort,
  formatPercent,
} from '@/lib/format';
import {
  budgetUsageTone,
  forecastTone,
} from '@/lib/signals';
import type { AuditRow, ConsumerUsage } from '@/api/types';

export function OverviewPage() {
  const me = useMe();
  const isAdmin = me.role === 'admin';
  const [scope, setScope] = useState<string | null>(null);

  const effectiveConsumer = isAdmin ? scope : me.consumer;
  const summaryQ = useSummary(isAdmin ? scope : undefined);

  const forecastQ = useForecast(effectiveConsumer);
  const aggConsumers = isAdmin && !scope ? me.visible_consumers : [];
  const aggQ = useAggregateForecast(aggConsumers);

  const requestsQ = useRequests({
    page: 1,
    page_size: 6,
    consumer: isAdmin && scope ? scope : undefined,
  });
  const alertsQ = useAlerts(isAdmin && scope ? { consumer: scope } : undefined);
  const consumersQ = useConsumers();

  const chart = effectiveConsumer
    ? {
        data: forecastQ.data
          ? {
              series: forecastQ.data.series,
              budget: forecastQ.data.budget,
              status: forecastQ.data.forecast_status,
            }
          : undefined,
        isPending: forecastQ.isPending,
        isError: forecastQ.isError,
        error: forecastQ.error,
      }
    : {
        data: aggQ.data,
        isPending: aggQ.isPending,
        isError: aggQ.isError,
        error: aggQ.error,
      };

  const s = summaryQ.data;

  return (
    <div>
      <PageHeader
        title="Overview"
        description={
          isAdmin
            ? scope
              ? `Scope: ${scope}`
              : 'Global scope across all consumers'
            : `Scope: ${me.consumer}`
        }
        actions={
          isAdmin ? (
            <ConsumerSelect
              value={scope}
              onChange={setScope}
              consumers={me.visible_consumers}
            />
          ) : undefined
        }
      />

      {/* KPI cards */}
      {summaryQ.isError ? (
        <QueryState
          isPending={false}
          isError
          error={summaryQ.error}
          data={undefined}
          loading={null}
          errorTitle="Unable to load summary"
        >
          {() => null}
        </QueryState>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-8">
          <StatCard
            label="Current spend"
            loading={summaryQ.isPending}
            value={s ? formatCurrency(s.current_spend, s.currency) : '—'}
          />
          <StatCard
            label="Budget used"
            loading={summaryQ.isPending}
            tone={s ? budgetUsageTone(s.budget_used_pct) : 'neutral'}
            value={s ? formatPercent(s.budget_used_pct, { decimals: 0 }) : '—'}
            sub={s ? `of ${formatCurrency(s.budget, s.currency)}` : undefined}
          />
          <StatCard
            label="Projected spend"
            loading={summaryQ.isPending}
            tone={s ? forecastTone(s.forecast_status) : 'neutral'}
            value={s ? formatCurrency(s.projected_spend, s.currency) : '—'}
          />
          <StatCard
            label="Requests"
            loading={summaryQ.isPending}
            value={s ? formatInt(s.requests_count) : '—'}
          />
          <StatCard
            label="Degraded"
            loading={summaryQ.isPending}
            tone={s && s.degraded_requests > 0 ? 'amber' : 'neutral'}
            value={s ? formatInt(s.degraded_requests) : '—'}
          />
          <StatCard
            label="Blocked"
            loading={summaryQ.isPending}
            tone={s && s.blocked_requests > 0 ? 'red' : 'neutral'}
            value={s ? formatInt(s.blocked_requests) : '—'}
          />
          <StatCard
            label="Active alerts"
            loading={summaryQ.isPending}
            tone={s && s.alerts_count > 0 ? 'amber' : 'neutral'}
            value={s ? formatInt(s.alerts_count) : '—'}
          />
          <StatCard
            label="Savings from routing"
            loading={summaryQ.isPending}
            tone={s && s.total_savings > 0 ? 'green' : 'neutral'}
            value={s ? formatCurrency(s.total_savings, s.currency) : '—'}
          />
        </div>
      )}

      {/* Charts */}
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader title="Spend over time" hint="Cumulative actual spend" />
          <CardBody>
            <QueryState
              isPending={chart.isPending}
              isError={chart.isError}
              error={chart.error}
              data={chart.data}
              loading={<Skeleton height={240} />}
              isEmpty={(d) => d.series.length === 0}
              emptyMessage="No spend recorded in this period."
              errorTitle="Unable to load spend"
            >
              {(d) => (
                <SpendOverTimeChart
                  points={d.series.map((p) => ({
                    bucket_start: p.bucket_start,
                    actual_cost: p.actual_cost,
                  }))}
                  currency={s?.currency ?? 'USD'}
                />
              )}
            </QueryState>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Forecast vs budget"
            hint="Actual + projected against budget"
          />
          <CardBody>
            <QueryState
              isPending={chart.isPending}
              isError={chart.isError}
              error={chart.error}
              data={chart.data}
              loading={<Skeleton height={280} />}
              isEmpty={(d) => d.series.length === 0}
              emptyMessage="No forecast available."
              errorTitle="Unable to load forecast"
            >
              {(d) => (
                <ForecastChart
                  series={d.series}
                  budget={d.budget}
                  status={d.status}
                  currency={s?.currency ?? 'USD'}
                />
              )}
            </QueryState>
          </CardBody>
        </Card>
      </div>

      {/* Admin comparison table */}
      {isAdmin ? (
        <Card className="mt-4">
          <CardHeader title="Consumers comparison" />
          <CardBody>
            <QueryState
              isPending={consumersQ.isPending}
              isError={consumersQ.isError}
              error={consumersQ.error}
              data={consumersQ.data}
              loading={<Skeleton height={140} />}
              isEmpty={(d) => d.items.length === 0}
              emptyMessage="No consumers in scope."
              errorTitle="Unable to load consumers"
            >
              {(d) => (
                <ResponsiveTable<ConsumerUsage>
                  columns={comparisonColumns}
                  rows={d.items}
                  getRowKey={(r) => r.consumer}
                />
              )}
            </QueryState>
          </CardBody>
        </Card>
      ) : null}

      {/* Latest audit + alerts */}
      <div className="mt-4 grid grid-cols-1 gap-3 xl:grid-cols-2">
        <Card>
          <CardHeader title="Latest audit records" />
          <CardBody>
            <QueryState
              isPending={requestsQ.isPending}
              isError={requestsQ.isError}
              error={requestsQ.error}
              data={requestsQ.data}
              loading={<Skeleton height={160} />}
              isEmpty={(d) => d.items.length === 0}
              emptyMessage="No requests in this period."
              errorTitle="Unable to load requests"
            >
              {(d) => (
                <ResponsiveTable<AuditRow>
                  columns={auditColumns(isAdmin)}
                  rows={d.items}
                  getRowKey={(r) => r.id}
                  rowClassName={(r) =>
                    r.budget_action === 'degraded'
                      ? 'bg-signal-amber-dim/40'
                      : undefined
                  }
                />
              )}
            </QueryState>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Latest alerts" />
          <CardBody>
            <QueryState
              isPending={alertsQ.isPending}
              isError={alertsQ.isError}
              error={alertsQ.error}
              data={alertsQ.data}
              loading={<Skeleton height={160} />}
              isEmpty={(d) => d.items.length === 0}
              emptyMessage="No active alerts."
              errorTitle="Unable to load alerts"
            >
              {(d) =>
                d.items.length === 0 ? (
                  <EmptyState message="No active alerts." />
                ) : (
                  <ul className="divide-y divide-line/60">
                    {d.items.slice(0, 6).map((a) => (
                      <li key={a.id} className="flex items-start gap-2 py-2">
                        <SeverityTag severity={a.severity} />
                        <div className="min-w-0">
                          <p className="truncate text-sm text-text">{a.title}</p>
                          <p className="text-[11px] text-text-muted">
                            {a.consumer} · {formatLocalTimeShort(a.created_at)}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              }
            </QueryState>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

const comparisonColumns: Column<ConsumerUsage>[] = [
  { key: 'consumer', header: 'Consumer', render: (r) => r.consumer },
  {
    key: 'current_spend',
    header: 'Spend',
    align: 'right',
    render: (r) => formatCurrency(r.current_spend),
  },
  {
    key: 'budget',
    header: 'Budget',
    align: 'right',
    render: (r) => formatCurrency(r.budget),
  },
  {
    key: 'budget_used_pct',
    header: 'Used',
    align: 'right',
    render: (r) => formatPercent(r.budget_used_pct, { decimals: 0 }),
  },
  {
    key: 'projected_spend',
    header: 'Projected',
    align: 'right',
    render: (r) => formatCurrency(r.projected_spend),
  },
  {
    key: 'forecast_status',
    header: 'Status',
    render: (r) => <ForecastStatusTag status={r.forecast_status} />,
  },
  {
    key: 'total_savings',
    header: 'Savings',
    align: 'right',
    render: (r) => formatCurrency(r.total_savings),
  },
];

function auditColumns(isAdmin: boolean): Column<AuditRow>[] {
  const cols: Column<AuditRow>[] = [
    {
      key: 'ts',
      header: 'Time',
      render: (r) => formatLocalTimeShort(r.timestamp_started),
    },
  ];
  if (isAdmin) {
    cols.push({ key: 'consumer', header: 'Consumer', render: (r) => r.consumer });
  }
  cols.push(
    { key: 'category', header: 'Category', render: (r) => r.category },
    {
      key: 'model',
      header: 'Model',
      render: (r) => (
        <span className="font-mono text-xs">{r.selected_model}</span>
      ),
    },
    {
      key: 'cost',
      header: 'Cost',
      align: 'right',
      render: (r) => formatCurrency(r.actual_model_cost),
    },
    {
      key: 'action',
      header: 'Action',
      render: (r) => <BudgetActionTag action={r.budget_action} />,
    },
    {
      key: 'status',
      header: 'Status',
      render: (r) => <StatusTag status={r.status} />,
    },
    {
      key: 'latency',
      header: 'Latency',
      align: 'right',
      render: (r) => formatLatency(r.latency_ms),
    },
  );
  return cols;
}
