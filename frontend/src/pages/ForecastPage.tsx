import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/states';
import { ConsumerSelect } from '@/components/ui/ConsumerSelect';
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable';
import { ForecastChart } from '@/components/charts/ForecastChart';
import { ForecastStatusTag } from '@/components/ui/tags';
import { Badge } from '@/components/ui/Badge';
import { useMe } from '@/auth/AuthContext';
import { useForecast, useForecastList } from '@/api/queries';
import {
  formatCurrency,
  formatLocalDate,
  humanizeEnum,
} from '@/lib/format';
import { forecastTone } from '@/lib/signals';
import type {
  ForecastBreakdownByCategory,
  ForecastBreakdownByModel,
  ForecastDetail,
  ForecastSummary,
} from '@/api/types';

export function ForecastPage() {
  const me = useMe();
  const isAdmin = me.role === 'admin';

  // Consumer role: always own. Admin: "All" shows per-consumer summary cards,
  // but a ?consumer= param (e.g. from the Consumers page) opens that detail.
  const [searchParams] = useSearchParams();
  const initialConsumer = searchParams.get('consumer');
  const [selected, setSelected] = useState<string | null>(
    isAdmin ? (initialConsumer && me.visible_consumers.includes(initialConsumer) ? initialConsumer : null) : me.consumer,
  );

  const listQ = useForecastList();
  const detailConsumer = isAdmin ? selected : me.consumer;
  const detailQ = useForecast(detailConsumer);

  return (
    <div>
      <PageHeader
        title="Forecast"
        description="Projected spend against budget, by consumer."
        actions={
          isAdmin ? (
            <ConsumerSelect
              value={selected}
              onChange={setSelected}
              consumers={me.visible_consumers}
              allLabel="All consumers (summary)"
            />
          ) : undefined
        }
      />

      {/* Admin global: per-consumer summary cards */}
      {isAdmin && !selected ? (
        <QueryState
          isPending={listQ.isPending}
          isError={listQ.isError}
          error={listQ.error}
          data={listQ.data}
          loading={<Skeleton height={160} />}
          isEmpty={(d) => d.items.length === 0}
          emptyMessage="No forecasts available."
          errorTitle="Unable to load forecasts"
        >
          {(d) => (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {d.items.map((f) => (
                <ForecastSummaryCard
                  key={f.consumer}
                  forecast={f}
                  onOpen={() => setSelected(f.consumer)}
                />
              ))}
            </div>
          )}
        </QueryState>
      ) : (
        <DetailView
          isPending={detailQ.isPending}
          isError={detailQ.isError}
          error={detailQ.error}
          data={detailQ.data}
        />
      )}
    </div>
  );
}

function ForecastSummaryCard({
  forecast,
  onOpen,
}: {
  forecast: ForecastSummary;
  onOpen: () => void;
}) {
  return (
    <Card>
      <CardHeader
        title={forecast.consumer}
        actions={<ForecastStatusTag status={forecast.forecast_status} />}
      />
      <CardBody className="space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <StatCard
            label="Spend so far"
            value={formatCurrency(forecast.spend_so_far, forecast.currency)}
          />
          <StatCard
            label="Projected"
            tone={forecastTone(forecast.forecast_status)}
            value={formatCurrency(forecast.projected_spend, forecast.currency)}
          />
        </div>
        <div className="flex items-center justify-between text-xs text-text-secondary">
          <span>Budget {formatCurrency(forecast.budget, forecast.currency)}</span>
          <Badge tone="neutral">confidence: {forecast.forecast_confidence}</Badge>
        </div>
        {forecast.budget_exhaustion_at ? (
          <p className="text-[11px] text-text-muted">
            Budget exhaustion: {formatLocalDate(forecast.budget_exhaustion_at)}
          </p>
        ) : null}
        <button
          type="button"
          onClick={onOpen}
          className="w-full border border-line bg-surface-raised px-2 py-1 text-xs text-text hover:border-line-strong rounded-sm"
        >
          View detail
        </button>
      </CardBody>
    </Card>
  );
}

function DetailView({
  isPending,
  isError,
  error,
  data,
}: {
  isPending: boolean;
  isError: boolean;
  error: unknown;
  data: ForecastDetail | undefined;
}) {
  return (
    <QueryState
      isPending={isPending}
      isError={isError}
      error={error}
      data={data}
      loading={<Skeleton height={420} />}
      errorTitle="Unable to load forecast"
    >
      {(f) => (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            <StatCard
              label="Spend so far"
              value={formatCurrency(f.spend_so_far, f.currency)}
            />
            <StatCard
              label="Budget"
              value={formatCurrency(f.budget, f.currency)}
            />
            <StatCard
              label="Projected"
              tone={forecastTone(f.forecast_status)}
              value={formatCurrency(f.projected_spend, f.currency)}
            />
            <StatCard
              label="Status"
              tone={forecastTone(f.forecast_status)}
              value={
                <span className="text-base">
                  {humanizeEnum(f.forecast_status)}
                </span>
              }
              sub={`confidence: ${f.forecast_confidence}`}
            />
            <StatCard
              label="Budget exhaustion"
              value={
                <span className="text-base">
                  {f.budget_exhaustion_at
                    ? formatLocalDate(f.budget_exhaustion_at)
                    : '—'}
                </span>
              }
              sub={`rate ${formatCurrency(f.weighted_hourly_rate, f.currency)}/h`}
            />
          </div>

          <Card>
            <CardHeader
              title={`Forecast — ${f.consumer}`}
              actions={<ForecastStatusTag status={f.forecast_status} />}
            />
            <CardBody>
              <ForecastChart
                series={f.series}
                budget={f.budget}
                status={f.forecast_status}
                currency={f.currency}
                height={320}
              />
            </CardBody>
          </Card>

          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card>
              <CardHeader title="Breakdown by category" />
              <CardBody>
                <ResponsiveTable<ForecastBreakdownByCategory>
                  columns={categoryCols}
                  rows={f.breakdown_by_category}
                  getRowKey={(r) => r.category}
                  emptyMessage="No category breakdown."
                />
              </CardBody>
            </Card>
            <Card>
              <CardHeader title="Breakdown by model" />
              <CardBody>
                <ResponsiveTable<ForecastBreakdownByModel>
                  columns={modelCols}
                  rows={f.breakdown_by_model}
                  getRowKey={(r) => r.selected_model}
                  emptyMessage="No model breakdown."
                />
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </QueryState>
  );
}

const categoryCols: Column<ForecastBreakdownByCategory>[] = [
  { key: 'category', header: 'Category', render: (r) => r.category },
  {
    key: 'spend_so_far',
    header: 'Spend so far',
    align: 'right',
    render: (r) => formatCurrency(r.spend_so_far),
  },
  {
    key: 'projected_spend',
    header: 'Projected',
    align: 'right',
    render: (r) => formatCurrency(r.projected_spend),
  },
];

const modelCols: Column<ForecastBreakdownByModel>[] = [
  {
    key: 'selected_model',
    header: 'Model',
    render: (r) => <span className="font-mono text-xs">{r.selected_model}</span>,
  },
  {
    key: 'spend_so_far',
    header: 'Spend so far',
    align: 'right',
    render: (r) => formatCurrency(r.spend_so_far),
  },
  {
    key: 'projected_spend',
    header: 'Projected',
    align: 'right',
    render: (r) => formatCurrency(r.projected_spend),
  },
];
