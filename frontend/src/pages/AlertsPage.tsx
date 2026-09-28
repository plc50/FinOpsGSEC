import { useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { QueryState } from '@/components/ui/states';
import { Field, Select } from '@/components/ui/controls';
import { ConsumerSelect } from '@/components/ui/ConsumerSelect';
import { SeverityTag } from '@/components/ui/tags';
import { Badge } from '@/components/ui/Badge';
import { useMe } from '@/auth/AuthContext';
import { useAlerts } from '@/api/queries';
import { formatLocalTime, humanizeEnum } from '@/lib/format';
import type { Severity } from '@/api/types';

const SEVERITIES: Severity[] = ['info', 'warning', 'critical'];

export function AlertsPage() {
  const me = useMe();
  const isAdmin = me.role === 'admin';
  const [consumer, setConsumer] = useState<string | null>(null);
  const [severity, setSeverity] = useState<string>('');

  const query = useAlerts({
    consumer: isAdmin && consumer ? consumer : undefined,
    severity: severity || undefined,
  });

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Budget, degradation and provider alerts (newest first)."
      />

      <Card className="mb-3">
        <CardBody className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {isAdmin ? (
            <Field label="Consumer">
              <ConsumerSelect
                value={consumer}
                onChange={setConsumer}
                consumers={me.visible_consumers}
                allLabel="All consumers"
              />
            </Field>
          ) : null}
          <Field label="Severity">
            <Select value={severity} onChange={(e) => setSeverity(e.target.value)}>
              <option value="">All</option>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          </Field>
        </CardBody>
      </Card>

      <QueryState
        isPending={query.isPending}
        isError={query.isError}
        error={query.error}
        data={query.data}
        loading={<Skeleton height={240} />}
        isEmpty={(d) => d.items.length === 0}
        emptyMessage="No active alerts."
        errorTitle="Unable to load alerts"
      >
        {(d) => (
          <ul className="space-y-2">
            {d.items.map((a) => (
              <li key={a.id}>
                <Card>
                  <CardBody className="flex items-start gap-3">
                    <SeverityTag severity={a.severity} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-text">
                          {a.title}
                        </span>
                        <Badge tone="neutral">{humanizeEnum(a.type)}</Badge>
                      </div>
                      <p className="mt-1 break-words text-sm text-text-secondary">
                        {a.message}
                      </p>
                      <p className="mt-1 text-[11px] text-text-muted">
                        {a.consumer} · {formatLocalTime(a.created_at)}
                        {a.related_audit_record_id
                          ? ` · audit ${a.related_audit_record_id}`
                          : ''}
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
