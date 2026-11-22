import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/states';
import { SeverityTag } from '@/components/ui/tags';
import { Badge } from '@/components/ui/Badge';
import { useRecommendations } from '@/api/queries';
import { formatLocalTime, humanizeEnum } from '@/lib/format';

/**
 * Recommendations (§7.8): render the backend `message` as-is. No generated
 * explanation text on the frontend.
 */
export function RecommendationsPage() {
  const query = useRecommendations();

  return (
    <div>
      <PageHeader
        title="Recommendations"
        description="Cost-optimization recommendations from the FinOps backend."
      />

      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        data={query.data}
        loading={<Skeleton height={200} />}
        isEmpty={(d) => d.items.length === 0}
        emptyMessage="No recommendations."
        errorTitle="Unable to load recommendations"
      >
        {(d) => (
          <ul className="space-y-2">
            {d.items.map((r) => (
              <li key={r.id}>
                <Card>
                  <CardBody className="flex items-start gap-3">
                    <SeverityTag severity={r.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone="neutral">{humanizeEnum(r.type)}</Badge>
                        <span className="text-[11px] text-text-muted">
                          {r.consumer}
                        </span>
                      </div>
                      {/* Backend message rendered verbatim (§7.8). */}
                      <p className="mt-1 break-words text-sm text-text">
                        {r.message}
                      </p>
                      <p className="mt-1 text-[11px] text-text-muted">
                        {formatLocalTime(r.created_at)}
                      </p>
                    </div>
                  </CardBody>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </QueryState>
    </div>
  );
}
