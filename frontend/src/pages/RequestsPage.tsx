import { Fragment, useMemo, useRef, useState } from 'react';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from '@tanstack/react-table';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState, EmptyState } from '@/components/ui/states';
import { Button, Field, Input, Select } from '@/components/ui/controls';
import { ConsumerSelect } from '@/components/ui/ConsumerSelect';
import { BudgetActionTag, StatusTag } from '@/components/ui/tags';
import { ProviderChip } from '@/components/ui/ProviderIcon';
import { RequestDetail } from '@/components/RequestDetail';
import { useMe } from '@/auth/AuthContext';
import { useRequests } from '@/api/queries';
import {
  formatCurrency,
  formatLatency,
  formatLocalTimeShort,
} from '@/lib/format';
import type {
  AuditRow,
  BudgetAction,
  Category,
  RequestStatus,
  RequestsQuery,
  TimeRange,
  UsageSource,
} from '@/api/types';

const CATEGORIES: Category[] = ['qa_internal', 'web_search', 'code_generation', 'misc'];
const BUDGET_ACTIONS: BudgetAction[] = ['allow', 'warn_only', 'degraded', 'blocked'];
const STATUSES: RequestStatus[] = [
  'completed',
  'degraded',
  'blocked',
  'warn_only',
  'semantic_cache_hit',
  'cancelled_by_client',
  'provider_error',
  'provider_stream_error',
];
const USAGE_SOURCES: UsageSource[] = ['provider', 'estimated', 'semantic_cache'];
const TIME_RANGES: TimeRange[] = ['1h', '24h', '7d', '30d'];

const PAGE_SIZE = 25;

/** Poll interval for the live audit trail (ms). */
const LIVE_REFETCH_MS = 4000;

const columnHelper = createColumnHelper<AuditRow>();

/** Pulsing "Live" indicator; brightens while a background refetch runs. */
function LiveIndicator({
  isFetching,
  updatedAt,
}: {
  isFetching: boolean;
  updatedAt: number;
}) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full border border-signal-green/25 bg-signal-green-dim px-2.5 py-1 text-[11px] font-semibold text-signal-green"
      title={
        updatedAt
          ? `Auto-refresh every ${LIVE_REFETCH_MS / 1000}s · last update ${new Date(updatedAt).toLocaleTimeString()}`
          : 'Auto-refresh enabled'
      }
    >
      <span
        className={
          'live-dot inline-block h-1.5 w-1.5 rounded-full bg-current' +
          (isFetching ? ' opacity-100' : ' opacity-80')
        }
      />
      Live
    </span>
  );
}

export function RequestsPage() {
  const me = useMe();
  const isAdmin = me.role === 'admin';

  const [filters, setFilters] = useState<RequestsQuery>({
    page: 1,
    page_size: PAGE_SIZE,
    time_range: '24h',
  });
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Live view: poll without ever flashing skeletons (keepPreviousData).
  const query = useRequests(filters, { refetchInterval: LIVE_REFETCH_MS });

  const rows = useMemo(() => query.data?.items ?? [], [query.data?.items]);

  // Rows that appeared in a refetch (not the initial load) animate in softly.
  const seenIdsRef = useRef<Set<string> | null>(null);
  const freshIds = useMemo(() => {
    const ids = new Set(rows.map((r) => r.id));
    if (seenIdsRef.current === null) {
      seenIdsRef.current = ids;
      return new Set<string>();
    }
    const fresh = new Set<string>();
    for (const id of ids) {
      if (!seenIdsRef.current.has(id)) fresh.add(id);
    }
    for (const id of fresh) seenIdsRef.current.add(id);
    return fresh;
  }, [rows]);

  function patch(next: Partial<RequestsQuery>) {
    setFilters((prev) => ({ ...prev, ...next, page: next.page ?? 1 }));
  }

  const columns = [
    columnHelper.accessor('timestamp_started', {
      header: 'Time',
      cell: (c) => formatLocalTimeShort(c.getValue()),
    }),
    ...(isAdmin
      ? [
          columnHelper.accessor('consumer', {
            header: 'Consumer',
            cell: (c) => c.getValue(),
          }),
        ]
      : []),
    columnHelper.accessor('category', {
      header: 'Category',
      cell: (c) => {
        const original = c.row.original.original_category;
        return original ? (
          <span
            title={`Reclassified from ${original} by policy`}
            className="inline-flex items-center gap-1"
          >
            {c.getValue()}
            <span className="text-signal-amber" aria-hidden>
              &darr;
            </span>
          </span>
        ) : (
          c.getValue()
        );
      },
    }),
    columnHelper.accessor('complexity_tier', {
      header: 'Tier',
      cell: (c) => c.getValue(),
    }),
    columnHelper.accessor('requested_model', {
      header: 'Requested',
      cell: (c) => c.getValue(),
    }),
    columnHelper.accessor('selected_provider', {
      header: 'Provider',
      cell: (c) => <ProviderChip provider={c.getValue()} />,
    }),
    columnHelper.accessor('selected_model', {
      header: 'Model',
      cell: (c) => <span className="font-mono text-xs">{c.getValue()}</span>,
    }),
    columnHelper.accessor('actual_model_cost', {
      header: 'Model cost',
      cell: (c) => formatCurrency(c.getValue()),
    }),
    columnHelper.accessor('routing_overhead_cost', {
      header: 'Overhead',
      cell: (c) => formatCurrency(c.getValue()),
    }),
    columnHelper.accessor('estimated_savings', {
      header: 'Est. savings',
      cell: (c) => {
        const row = c.row.original;
        if (row.budget_action !== 'degraded' || c.getValue() === null) {
          return <span className="text-text-muted">—</span>;
        }
        return (
          <span className="text-signal-amber">{formatCurrency(c.getValue())}</span>
        );
      },
    }),
    columnHelper.accessor('budget_action', {
      header: 'Action',
      cell: (c) => <BudgetActionTag action={c.getValue()} />,
    }),
    columnHelper.accessor('status', {
      header: 'Status',
      cell: (c) => <StatusTag status={c.getValue()} />,
    }),
    columnHelper.accessor('latency_ms', {
      header: 'Latency',
      cell: (c) => formatLatency(c.getValue()),
    }),
    columnHelper.accessor('prompt_preview', {
      header: 'Prompt',
      cell: (c) => (
        <span className="block max-w-[16rem] truncate text-text-secondary">
          {c.getValue()}
        </span>
      ),
    }),
  ];

  const table = useReactTable({
    data: rows,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
  });

  const total = query.data?.total ?? 0;
  const page = filters.page ?? 1;
  const pageCount = Math.max(1, Math.ceil(total / (filters.page_size ?? PAGE_SIZE)));

  function toggle(id: string) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  return (
    <div>
      <PageHeader
        title="Requests"
        description="Audit trail of intercepted AI calls with routing and cost."
        actions={
          <LiveIndicator
            isFetching={query.isFetching}
            updatedAt={query.dataUpdatedAt}
          />
        }
      />

      {/* Filters */}
      <Card className="mb-3">
        <CardBody className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {isAdmin ? (
            <Field label="Consumer">
              <ConsumerSelect
                value={filters.consumer ?? null}
                onChange={(v) => patch({ consumer: v ?? undefined })}
                consumers={me.visible_consumers}
                allLabel="All consumers"
              />
            </Field>
          ) : null}
          <Field label="Category">
            <Select
              value={filters.category ?? ''}
              onChange={(e) =>
                patch({ category: (e.target.value || undefined) as Category | undefined })
              }
            >
              <option value="">All</option>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Budget action">
            <Select
              value={filters.budget_action ?? ''}
              onChange={(e) =>
                patch({
                  budget_action: (e.target.value || undefined) as
                    | BudgetAction
                    | undefined,
                })
              }
            >
              <option value="">All</option>
              {BUDGET_ACTIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select
              value={filters.status ?? ''}
              onChange={(e) =>
                patch({ status: (e.target.value || undefined) as RequestStatus | undefined })
              }
            >
              <option value="">All</option>
              {STATUSES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Usage source">
            <Select
              value={filters.usage_source ?? ''}
              onChange={(e) =>
                patch({
                  usage_source: (e.target.value || undefined) as
                    | UsageSource
                    | undefined,
                })
              }
            >
              <option value="">All</option>
              {USAGE_SOURCES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Provider">
            <Input
              placeholder="e.g. tabbyapi"
              value={filters.provider ?? ''}
              onChange={(e) => patch({ provider: e.target.value || undefined })}
            />
          </Field>
          <Field label="Model">
            <Input
              placeholder="e.g. gemma-4-12B-it-exl3"
              value={filters.model ?? ''}
              onChange={(e) => patch({ model: e.target.value || undefined })}
            />
          </Field>
          <Field label="Time range">
            <Select
              value={filters.time_range ?? '24h'}
              onChange={(e) => patch({ time_range: e.target.value as TimeRange })}
            >
              {TIME_RANGES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button
              variant="ghost"
              onClick={() =>
                setFilters({ page: 1, page_size: PAGE_SIZE, time_range: '24h' })
              }
            >
              Reset filters
            </Button>
          </div>
        </CardBody>
      </Card>

      {/* Table / states */}
      {query.isError ? (
        <ErrorState
          title="Unable to load requests"
          error={query.error}
          onRetry={() => query.refetch()}
        />
      ) : query.isPending ? (
        <Skeleton height={320} />
      ) : rows.length === 0 ? (
        <EmptyState message="No requests in this period." />
      ) : (
        <Card>
          {/* Desktop table (TanStack) */}
          <div className="hidden overflow-x-auto lg:block">
            <table className="w-full border-collapse text-sm">
              <thead>
                {table.getHeaderGroups().map((hg) => (
                  <tr key={hg.id} className="border-b border-line text-left">
                    <th className="w-6 px-2 py-1.5" />
                    {hg.headers.map((h) => (
                      <th
                        key={h.id}
                        className="whitespace-nowrap px-2 py-1.5 text-[11px] font-medium uppercase tracking-wide text-text-secondary"
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map((r) => {
                  const isOpen = !!expanded[r.id];
                  const degraded = r.original.budget_action === 'degraded';
                  return (
                    <Fragment key={r.id}>
                      <tr
                        onClick={() => toggle(r.id)}
                        className={
                          'cursor-pointer border-b border-line/60 transition-colors hover:bg-surface-raised ' +
                          (degraded ? 'bg-signal-amber-dim/40 ' : '') +
                          (freshIds.has(r.id) ? 'row-enter' : '')
                        }
                      >
                        <td className="px-2 py-1.5 text-text-muted">
                          {isOpen ? '▾' : '▸'}
                        </td>
                        {r.getVisibleCells().map((cell) => (
                          <td
                            key={cell.id}
                            className="whitespace-nowrap px-2 py-1.5 align-middle tabular"
                          >
                            {flexRender(
                              cell.column.columnDef.cell,
                              cell.getContext(),
                            )}
                          </td>
                        ))}
                      </tr>
                      {isOpen ? (
                        <tr>
                          <td colSpan={r.getVisibleCells().length + 1} className="p-0">
                            <RequestDetail row={r.original} />
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="space-y-2 p-2 lg:hidden">
            {rows.map((row) => {
              const isOpen = !!expanded[row.id];
              const degraded = row.budget_action === 'degraded';
              return (
                <div
                  key={row.id}
                  className={
                    'rounded-sm border border-line shadow-card ' +
                    (degraded ? 'bg-signal-amber-dim/40' : 'bg-surface') +
                    (freshIds.has(row.id) ? ' row-enter' : '')
                  }
                >
                  <button
                    type="button"
                    onClick={() => toggle(row.id)}
                    className="flex w-full items-center justify-between gap-2 p-2.5 text-left"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 truncate font-mono text-xs text-text">
                        <ProviderChip
                          provider={row.selected_provider}
                          label={`${row.selected_provider}/${row.selected_model}`}
                        />
                      </p>
                      <p className="text-[11px] text-text-muted">
                        {row.consumer} · {formatLocalTimeShort(row.timestamp_started)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="tabular text-sm">
                        {formatCurrency(row.actual_model_cost)}
                      </span>
                      <StatusTag status={row.status} />
                    </div>
                  </button>
                  {isOpen ? <RequestDetail row={row} /> : null}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Pagination */}
      {!query.isPending && !query.isError && total > 0 ? (
        <div className="mt-3 flex items-center justify-between text-xs text-text-secondary">
          <span>
            {total.toLocaleString()} records · page {page} / {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              disabled={page <= 1}
              onClick={() => patch({ page: page - 1 })}
            >
              Prev
            </Button>
            <Button
              size="sm"
              disabled={page >= pageCount}
              onClick={() => patch({ page: page + 1 })}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
