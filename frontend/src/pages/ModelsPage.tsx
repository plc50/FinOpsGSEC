import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/states';
import { ResponsiveTable, type Column } from '@/components/ui/ResponsiveTable';
import { Badge } from '@/components/ui/Badge';
import { ProviderChip } from '@/components/ui/ProviderIcon';
import { useModels } from '@/api/queries';
import type { Model } from '@/api/types';

/**
 * Models (§7.6): show only id, owned_by and whether the model is `auto`.
 * MVP restriction — do NOT render category, tier, capabilities, prices or
 * provider routing metadata here.
 */
const columns: Column<Model>[] = [
  {
    key: 'id',
    header: 'Model id',
    render: (r) => <span className="font-mono text-xs">{r.id}</span>,
  },
  {
    key: 'owned_by',
    header: 'Owned by',
    render: (r) => <ProviderChip provider={r.owned_by} />,
  },
  {
    key: 'auto',
    header: 'Auto',
    render: (r) =>
      r.id === 'auto' ? (
        <Badge tone="green">auto</Badge>
      ) : (
        <span className="text-text-muted">—</span>
      ),
  },
];

export function ModelsPage() {
  const query = useModels();

  return (
    <div>
      <PageHeader
        title="Models"
        description="Models visible to this API key via /v1/models."
      />

      <Card>
        <CardBody>
          <QueryState
            isPending={query.isPending}
            isError={query.isError}
            error={query.error}
            data={query.data}
            loading={<Skeleton height={200} />}
            isEmpty={(d) => d.data.length === 0}
            emptyMessage="No models available."
            errorTitle="Unable to load models"
          >
            {(d) => (
              <ResponsiveTable<Model>
                columns={columns}
                rows={d.data}
                getRowKey={(r) => r.id}
              />
            )}
          </QueryState>
        </CardBody>
      </Card>
    </div>
  );
}
