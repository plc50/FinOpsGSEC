import { useQueries } from '@tanstack/react-query';
import { endpoints } from './endpoints';
import { useApiKey } from '@/auth/AuthContext';
import type { ForecastStatus } from './types';

export interface AggregatedForecast {
  series: { bucket_start: string; actual_cost: number | null; projected_cost: number | null }[];
  budget: number;
  status: ForecastStatus;
}

/**
 * Aggregate multiple consumer forecasts into a single global time series for the
 * admin Overview (there is no dedicated global series endpoint). Buckets are
 * combined by bucket_start so mismatched buckets still sum correctly.
 */
export function useAggregateForecast(consumers: string[]) {
  const apiKey = useApiKey();
  const results = useQueries({
    queries: consumers.map((consumer) => ({
      queryKey: ['forecast', apiKey, consumer],
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        endpoints.forecast(apiKey, consumer, signal),
      staleTime: 30 * 1000,
      retry: false,
    })),
  });

  const isPending = results.some((r) => r.isPending);
  const isError = results.some((r) => r.isError);
  const error = results.find((r) => r.isError)?.error;

  let data: AggregatedForecast | undefined;
  if (!isPending && !isError) {
    const actualMap = new Map<string, number | null>();
    const projMap = new Map<string, number | null>();
    let budget = 0;
    let anyOverBudget = false;
    let anyAtRisk = false;

    for (const r of results) {
      const f = r.data;
      if (!f) continue;
      budget += f.budget;
      if (f.forecast_status === 'projected_over_budget') anyOverBudget = true;
      if (f.forecast_status === 'at_risk') anyAtRisk = true;
      for (const p of f.series) {
        if (p.actual_cost !== null) {
          actualMap.set(p.bucket_start, (actualMap.get(p.bucket_start) ?? 0) + p.actual_cost);
        }
        if (p.projected_cost !== null) {
          projMap.set(p.bucket_start, (projMap.get(p.bucket_start) ?? 0) + p.projected_cost);
        }
      }
    }

    const buckets = Array.from(
      new Set([...actualMap.keys(), ...projMap.keys()]),
    ).sort((a, b) => Date.parse(a) - Date.parse(b));

    const status: ForecastStatus = anyOverBudget
      ? 'projected_over_budget'
      : anyAtRisk
        ? 'at_risk'
        : 'on_track';

    data = {
      budget: Math.round(budget * 100) / 100,
      status,
      series: buckets.map((b) => ({
        bucket_start: b,
        actual_cost: actualMap.has(b) ? (actualMap.get(b) as number) : null,
        projected_cost: projMap.has(b) ? (projMap.get(b) as number) : null,
      })),
    };
  }

  return { data, isPending, isError, error };
}
