import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { StatCard } from '@/components/ui/StatCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/states';
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable';
import { Button } from '@/components/ui/controls';
import { BudgetEditModal } from '@/components/BudgetEditModal';
import { useMe } from '@/auth/AuthContext';
import { useBudgets } from '@/api/queries';
import { formatCurrency, formatPercent } from '@/lib/format';
import { budgetUsageTone } from '@/lib/signals';
import type { Budget } from '@/api/types';

export function BudgetsPage() {
  const me = useMe();
  const isAdmin = me.role === 'admin';
  const query = useBudgets();
  const [editing, setEditing] = useState<Budget | null>(null);

  const columns: Column<Budget>[] = [
    { key: 'consumer', header: 'Consumer', render: (r) => r.consumer },
    {
      key: 'budget',
      header: 'Budget',
      align: 'right',
      render: (r) => formatCurrency(r.budget, r.currency),
    },
    {
      key: 'current_spend',
      header: 'Spend',
      align: 'right',
      render: (r) => formatCurrency(r.current_spend, r.currency),
    },
    {
      key: 'budget_used_pct',
      header: 'Used',
      align: 'right',
      render: (r) => (
        <span
          className={
            budgetUsageTone(r.budget_used_pct, r.warning_threshold) === 'red'
              ? 'text-signal-red'
              : budgetUsageTone(r.budget_used_pct, r.warning_threshold) === 'amber'
                ? 'text-signal-amber'
                : 'text-text'
          }
        >
          {formatPercent(r.budget_used_pct, { decimals: 0 })}
        </span>
      ),
    },
    {
      key: 'warning_threshold',
      header: 'Warn at',
      align: 'right',
      render: (r) => formatPercent(r.warning_threshold, { decimals: 0 }),
    },
    ...(isAdmin
      ? [
          {
            key: 'actions',
            header: 'Actions',
            align: 'right' as const,
            render: (r: Budget) => (
              <Button
                size="sm"
                variant="default"
                onClick={() => setEditing(r)}
              >
                Edit
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <div>
      <PageHeader
        title="Budgets"
        description={
          isAdmin
            ? 'Configure per-consumer spend limits and warning thresholds.'
            : 'Your team budget (read-only).'
        }
      />

      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        data={query.data}
        loading={<Skeleton height={200} />}
        isEmpty={(d) => d.items.length === 0}
        emptyMessage="No budgets configured."
        errorTitle="Unable to load budgets"
      >
        {(d) =>
          !isAdmin && d.items.length === 1 ? (
            <ConsumerBudgetSummary budget={d.items[0]} />
          ) : (
            <Card>
              <CardBody>
                <ResponsiveTable<Budget>
                  columns={columns}
                  rows={d.items}
                  getRowKey={(r) => r.consumer}
                />
              </CardBody>
            </Card>
          )
        }
      </QueryState>

      {editing ? (
        <BudgetEditModal
          open={!!editing}
          onClose={() => setEditing(null)}
          consumer={editing.consumer}
          initialBudget={editing.budget}
          initialWarningThreshold={editing.warning_threshold}
        />
      ) : null}
    </div>
  );
}

function ConsumerBudgetSummary({ budget }: { budget: Budget }) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      <StatCard
        label="Budget"
        value={formatCurrency(budget.budget, budget.currency)}
      />
      <StatCard
        label="Current spend"
        value={formatCurrency(budget.current_spend, budget.currency)}
      />
      <StatCard
        label="Used"
        tone={budgetUsageTone(budget.budget_used_pct, budget.warning_threshold)}
        value={formatPercent(budget.budget_used_pct, { decimals: 0 })}
      />
      <StatCard
        label="Warning threshold"
        value={formatPercent(budget.warning_threshold, { decimals: 0 })}
      />
    </div>
  );
}
