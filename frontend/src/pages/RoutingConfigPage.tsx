import { useMemo, useState } from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { Card, CardBody, CardHeader } from '@/components/ui/Card';
import { Skeleton } from '@/components/ui/Skeleton';
import { ErrorState, EmptyState } from '@/components/ui/states';
import { Button, Field, Select } from '@/components/ui/controls';
import { ProviderIcon } from '@/components/ui/ProviderIcon';
import {
  useDeleteRoutingConfig,
  useRoutingCatalog,
  useRoutingConfig,
  useUpdateRoutingConfig,
} from '@/api/queries';
import { useMe } from '@/auth/AuthContext';
import { formatCurrency } from '@/lib/format';
import type {
  Category,
  RoutingConfigRow,
  RoutingModel,
} from '@/api/types';

function routeKey(consumer: string, category: string, tier: string) {
  return `${consumer}/${category}/${tier}`;
}

export function RoutingConfigPage() {
  const me = useMe();
  const catalog = useRoutingCatalog();
  const config = useRoutingConfig();
  const update = useUpdateRoutingConfig();
  const remove = useDeleteRoutingConfig();

  const consumers = useMemo(() => ['global', ...me.visible_consumers], [me]);
  const [consumer, setConsumer] = useState('global');
  const [category, setCategory] = useState<Category>('misc');

  const configured = useMemo(() => {
    const map = new Map<string, RoutingConfigRow>();
    for (const row of config.data?.items ?? []) {
      map.set(routeKey(row.consumer, row.category, row.complexity_tier), row);
    }
    return map;
  }, [config.data?.items]);

  const modelByProvider = useMemo(() => {
    const map = new Map<string, RoutingModel[]>();
    for (const model of catalog.data?.models ?? []) {
      const list = map.get(model.provider) ?? [];
      map.set(model.provider, [...list, model]);
    }
    return map;
  }, [catalog.data?.models]);

  const tiers = catalog.data?.complexity_tiers ?? [];
  const categories = catalog.data?.categories ?? [];
  const providers = catalog.data?.providers ?? [];

  if (catalog.isError || config.isError) {
    return (
      <ErrorState
        title="Unable to load routing configuration"
        error={catalog.error ?? config.error}
        onRetry={() => {
          catalog.refetch();
          config.refetch();
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Routing config"
        description="Admin-managed provider/model routing by team, category and complexity."
      />

      <Card className="mb-3">
        <CardBody className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Equipo">
            <Select value={consumer} onChange={(e) => setConsumer(e.target.value)}>
              {consumers.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Category">
            <Select
              value={category}
              onChange={(e) => setCategory(e.target.value as Category)}
            >
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          {providers.length > 0 ? (
            <div className="sm:col-span-2 lg:col-span-2">
              <p className="mb-1 block text-[11px] uppercase tracking-wide text-text-secondary">
                Available providers
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {providers.map((p) => (
                  <span
                    key={p.id}
                    className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-raised px-2 py-1 text-xs text-text"
                  >
                    <ProviderIcon provider={p.id} size="sm" />
                    {p.display_name}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </CardBody>
      </Card>

      {catalog.isPending || config.isPending ? (
        <Skeleton height={320} />
      ) : tiers.length === 0 ? (
        <EmptyState message="No routing catalog loaded." />
      ) : (
        <Card>
          <CardHeader title="Complexity routes" />
          <CardBody className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-text-secondary">
                  <th className="px-2 py-1.5">Tier</th>
                  <th className="px-2 py-1.5">Provider</th>
                  <th className="px-2 py-1.5">Model</th>
                  <th className="px-2 py-1.5">Capabilities</th>
                  <th className="px-2 py-1.5 text-right">Input / 1M</th>
                  <th className="px-2 py-1.5 text-right">Output / 1M</th>
                  <th className="px-2 py-1.5" />
                </tr>
              </thead>
              <tbody>
                {tiers.map((tier) => {
                  const key = routeKey(consumer, category, tier);
                  const row = configured.get(key);
                  const provider =
                    row?.configured_provider ?? row?.default_provider ?? providers[0]?.id ?? '';
                  const model = row?.configured_model ?? row?.default_model ?? '';
                  const models = modelByProvider.get(provider) ?? [];
                  const selectedModel = models.find((m) => m.model === model);

                  return (
                    <tr key={tier} className="border-b border-line/60">
                      <td className="px-2 py-2 font-mono text-xs">{tier}</td>
                      <td className="px-2 py-2">
                        <div className="flex items-center gap-2">
                          <ProviderIcon provider={provider} />
                          <Select
                            value={provider}
                            onChange={(e) => {
                              const nextProvider = e.target.value;
                              const nextModel =
                                modelByProvider.get(nextProvider)?.[0]?.model ?? '';
                              update.mutate({
                                consumer,
                                category,
                                complexityTier: tier,
                                body: {
                                  provider: nextProvider,
                                  model: nextModel,
                                  enabled: true,
                                },
                              });
                            }}
                          >
                            {providers.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.display_name}
                              </option>
                            ))}
                          </Select>
                        </div>
                      </td>
                      <td className="px-2 py-2">
                        <Select
                          value={model}
                          onChange={(e) =>
                            update.mutate({
                              consumer,
                              category,
                              complexityTier: tier,
                              body: { provider, model: e.target.value, enabled: true },
                            })
                          }
                        >
                          {models.map((m) => (
                            <option key={`${m.provider}/${m.model}`} value={m.model}>
                              {m.display_name}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-2 py-2 text-xs text-text-secondary">
                        {(selectedModel?.capabilities ?? row?.model_capabilities ?? []).join(', ')}
                      </td>
                      <td className="px-2 py-2 text-right tabular">
                        {formatCurrency(selectedModel?.input_price_per_1m_tokens ?? 0)}
                      </td>
                      <td className="px-2 py-2 text-right tabular">
                        {formatCurrency(selectedModel?.output_price_per_1m_tokens ?? 0)}
                      </td>
                      <td className="px-2 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!row || remove.isPending}
                          onClick={() =>
                            remove.mutate({
                              consumer,
                              category,
                              complexityTier: tier,
                            })
                          }
                        >
                          Reset
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
