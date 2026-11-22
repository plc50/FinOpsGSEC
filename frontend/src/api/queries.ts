import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { endpoints } from './endpoints';
import { useApiKey } from '@/auth/AuthContext';
import type {
  BudgetUpdateRequest,
  RequestsQuery,
  RoutingConfigUpdateRequest,
} from './types';

const STALE = 30 * 1000;
/** Slow-changing catalogs (models, routing catalog) can stay fresh longer. */
const STALE_STATIC = 5 * 60 * 1000;

export function useSummary(consumer?: string | null) {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['summary', apiKey, consumer ?? '__scope__'],
    queryFn: ({ signal }) => endpoints.summary(apiKey, consumer, signal),
    staleTime: STALE,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useConsumers(timeRange?: string) {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['consumers', apiKey, timeRange ?? '24h'],
    queryFn: ({ signal }) => endpoints.consumers(apiKey, timeRange, signal),
    staleTime: STALE,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useRequests(
  query: RequestsQuery,
  options?: {
    /** Poll interval in ms for live views (e.g. the Requests page). */
    refetchInterval?: number;
    refetchIntervalInBackground?: boolean;
  },
) {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['requests', apiKey, query],
    queryFn: ({ signal }) => endpoints.requests(apiKey, query, signal),
    staleTime: STALE,
    retry: false,
    // Keep previous rows while refetching / changing filters so the table
    // never flashes back to a skeleton.
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval,
    refetchIntervalInBackground: options?.refetchIntervalInBackground ?? false,
  });
}

export function useBudgets() {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['budgets', apiKey],
    queryFn: ({ signal }) => endpoints.budgets(apiKey, signal),
    staleTime: STALE,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useSavings(query?: {
  consumer?: string;
  start_date?: string;
  end_date?: string;
}) {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['savings', apiKey, query ?? {}],
    queryFn: ({ signal }) => endpoints.savings(apiKey, query, signal),
    staleTime: STALE,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useForecastList() {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['forecast-list', apiKey],
    queryFn: ({ signal }) => endpoints.forecastList(apiKey, signal),
    staleTime: STALE,
    retry: false,
  });
}

export function useForecast(consumer: string | null) {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['forecast', apiKey, consumer],
    queryFn: ({ signal }) => endpoints.forecast(apiKey, consumer as string, signal),
    enabled: !!consumer,
    staleTime: STALE,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useAlerts(query?: {
  consumer?: string;
  severity?: string;
  type?: string;
}) {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['alerts', apiKey, query ?? {}],
    queryFn: ({ signal }) => endpoints.alerts(apiKey, query, signal),
    staleTime: STALE,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useRecommendations(query?: {
  consumer?: string;
  severity?: string;
  type?: string;
}) {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['recommendations', apiKey, query ?? {}],
    queryFn: ({ signal }) => endpoints.recommendations(apiKey, query, signal),
    staleTime: STALE,
    retry: false,
    placeholderData: keepPreviousData,
  });
}

export function useModels() {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['models', apiKey],
    queryFn: ({ signal }) => endpoints.models(apiKey, signal),
    staleTime: STALE_STATIC,
    retry: false,
  });
}

export function useRoutingCatalog() {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['routing-catalog', apiKey],
    queryFn: ({ signal }) => endpoints.routingCatalog(apiKey, signal),
    staleTime: STALE_STATIC,
    retry: false,
  });
}

export function useRoutingConfig() {
  const apiKey = useApiKey();
  return useQuery({
    queryKey: ['routing-config', apiKey],
    queryFn: ({ signal }) => endpoints.routingConfig(apiKey, signal),
    staleTime: STALE,
    retry: false,
  });
}

export function useUpdateRoutingConfig() {
  const apiKey = useApiKey();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      consumer: string;
      category: string;
      complexityTier: string;
      body: RoutingConfigUpdateRequest;
    }) =>
      endpoints.updateRoutingConfig(
        apiKey,
        vars.consumer,
        vars.category,
        vars.complexityTier,
        vars.body,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing-config'] });
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
    },
  });
}

export function useDeleteRoutingConfig() {
  const apiKey = useApiKey();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: {
      consumer: string;
      category: string;
      complexityTier: string;
    }) =>
      endpoints.deleteRoutingConfig(
        apiKey,
        vars.consumer,
        vars.category,
        vars.complexityTier,
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['routing-config'] });
      qc.invalidateQueries({ queryKey: ['requests'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
    },
  });
}

export function useUpdateBudget() {
  const apiKey = useApiKey();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { consumer: string; body: BudgetUpdateRequest }) =>
      endpoints.updateBudget(apiKey, vars.consumer, vars.body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['budgets'] });
      qc.invalidateQueries({ queryKey: ['consumers'] });
      qc.invalidateQueries({ queryKey: ['summary'] });
      qc.invalidateQueries({ queryKey: ['forecast'] });
      qc.invalidateQueries({ queryKey: ['forecast-list'] });
    },
  });
}
