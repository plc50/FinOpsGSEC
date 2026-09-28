import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/states';
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable';
import { Button } from '@/components/ui/controls';
import { ForecastStatusTag } from '@/components/ui/tags';
import { BudgetEditModal } from '@/components/BudgetEditModal';
import { useBudgets, useConsumers } from '@/api/queries';
import {
  formatCurrency,
  formatInt,
  formatLatency,
  formatPercent,
} from '@/lib/format';
import { budgetUsageTone } from '@/lib/signals';
import type { ConsumerUsage } from '@/api/types';

export function ConsumersPage() {
  const navigate = useNavigate();
  const consumersQ = useConsumers();
  const budgetsQ = useBudgets();
  const [editing, setEditing] = useState<string | null>(null);

  const budgetFor = (consumer: string) =>
    budgetsQ.data?.items.find((b) => b.consumer === consumer);

  const columns: Column<ConsumerUsage>[] = [
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
      render: (r) => (
        <span
          className={
            budgetUsageTone(r.budget_used_pct) === 'red'
              ? 'text-signal-red'
              : budgetUsageTone(r.budget_used_pct) === 'amber'
                ? 'text-signal-amber'
                : 'text-text'
          }
        >
          {formatPercent(r.budget_used_pct, { decimals: 0 })}
        </span>
      ),
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
      key: 'requests_count',
      header: 'Requests',
      align: 'right',
      render: (r) => formatInt(r.requests_count),
    },
    {
      key: 'degraded_requests',
      header: 'Degraded',
      align: 'right',
      render: (r) => formatInt(r.degraded_requests),
    },
    {
      key: 'blocked_requests',
      header: 'Blocked',
      align: 'right',
      render: (r) => formatInt(r.blocked_requests),
    },
    {
      key: 'total_savings',
      header: 'Savings',
      align: 'right',
      render: (r) => formatCurrency(r.total_savings),
    },
    {
      key: 'avg_latency_ms',
      header: 'Avg latency',
      align: 'right',
      render: (r) => formatLatency(r.avg_latency_ms),
    },
    {
      key: 'p95_latency_ms',
      header: 'p95 latency',
      align: 'right',
      render: (r) => formatLatency(r.p95_latency_ms),
    },
    {
      key: 'actions',
      header: 'Actions',
      render: (r) => (
        <div className="flex justify-end gap-1">
          <Button
            size="sm"
            variant="ghost"
            onClick={(e) => {
              e.stopPropagation();
              navigate(`/forecast?consumer=${encodeURIComponent(r.consumer)}`);
            }}
          >
            View
          </Button>
          <Button
            size="sm"
            variant="default"
            onClick={(e) => {
              e.stopPropagation();
              setEditing(r.consumer);
            }}
          >
            Edit budget
          </Button>
        </div>
      ),
    },
  ];

  const editingBudget = editing ? budgetFor(editing) : undefined;

  return (
    <div>
      <PageHeader
        title="Consumers"
        description="Per-consumer spend, forecast and latency comparison."
      />

      <Card>
        <CardBody>
          <QueryState
            isPending={consumersQ.isPending}
            isError={consumersQ.isError}
            error={consumersQ.error}
            data={consumersQ.data}
            loading={<Skeleton height={220} />}
            isEmpty={(d) => d.items.length === 0}
            emptyMessage="No consumers in scope."
            errorTitle="Unable to load consumers"
          >
            {(d) => (
              <ResponsiveTable<ConsumerUsage>
                columns={columns}
                rows={d.items}
                getRowKey={(r) => r.consumer}
              />
            )}
          </QueryState>
        </CardBody>
      </Card>

      {editing ? (
        <BudgetEditModal
          open={!!editing}
          onClose={() => setEditing(null)}
          consumer={editing}
          initialBudget={editingBudget?.budget ?? 0}
          initialWarningThreshold={editingBudget?.warning_threshold ?? 0.8}
        />
      ) : null}
    </div>
  );
}
