import { apiRequest } from './client';
import type {
  AlertsResponse,
  ChatCompletionRequest,
  ChatCompletionResponse,
  BudgetUpdateRequest,
  BudgetUpdateResponse,
  BudgetsResponse,
  ConsumersResponse,
  ForecastDetail,
  ForecastListResponse,
  HealthResponse,
  Me,
  ModelsResponse,
  RecommendationsResponse,
  RequestsQuery,
  RequestsResponse,
  RoutingCatalogResponse,
  RoutingConfigResponse,
  RoutingConfigUpdateRequest,
  RoutingConfigRow,
  SavingsResponse,
  Summary,
} from './types';

export type ApiTransport = 'default' | 'live' | 'mock';

export const endpoints = {
  me: (apiKey: string, signal?: AbortSignal) =>
    apiRequest<Me>('/dashboard/me', { apiKey, signal }),

  summary: (apiKey: string, consumer?: string | null, signal?: AbortSignal) =>
    apiRequest<Summary>('/dashboard/summary', {
      apiKey,
      signal,
      query: consumer ? { consumer } : undefined,
    }),

  consumers: (apiKey: string, timeRange?: string, signal?: AbortSignal) =>
    apiRequest<ConsumersResponse>('/dashboard/usage/consumers', {
      apiKey,
      signal,
      query: timeRange ? { time_range: timeRange } : undefined,
    }),

  requests: (apiKey: string, query: RequestsQuery, signal?: AbortSignal) =>
    apiRequest<RequestsResponse>('/dashboard/usage/requests', {
      apiKey,
      signal,
      query: query as Record<string, unknown>,
    }),

  budgets: (apiKey: string, signal?: AbortSignal) =>
    apiRequest<BudgetsResponse>('/dashboard/budgets', { apiKey, signal }),

  updateBudget: (
    apiKey: string,
    consumer: string,
    body: BudgetUpdateRequest,
  ) =>
    apiRequest<BudgetUpdateResponse>(
      `/dashboard/budgets/${encodeURIComponent(consumer)}`,
      { apiKey, method: 'POST', body },
    ),

  savings: (
    apiKey: string,
    query?: { consumer?: string; start_date?: string; end_date?: string },
    signal?: AbortSignal,
  ) =>
    apiRequest<SavingsResponse>('/dashboard/savings', {
      apiKey,
      signal,
      query: query as Record<string, unknown> | undefined,
    }),

  forecastList: (apiKey: string, signal?: AbortSignal) =>
    apiRequest<ForecastListResponse>('/dashboard/forecast', { apiKey, signal }),

  forecast: (apiKey: string, consumer: string, signal?: AbortSignal) =>
    apiRequest<ForecastDetail>(
      `/dashboard/forecast/${encodeURIComponent(consumer)}`,
      { apiKey, signal },
    ),

  alerts: (
    apiKey: string,
    query?: { consumer?: string; severity?: string; type?: string },
    signal?: AbortSignal,
  ) =>
    apiRequest<AlertsResponse>('/dashboard/alerts', {
      apiKey,
      signal,
      query: query as Record<string, unknown> | undefined,
    }),

  recommendations: (
    apiKey: string,
    query?: { consumer?: string; severity?: string; type?: string },
    signal?: AbortSignal,
  ) =>
    apiRequest<RecommendationsResponse>('/dashboard/recommendations', {
      apiKey,
      signal,
      query: query as Record<string, unknown> | undefined,
    }),

  models: (apiKey: string, signal?: AbortSignal) =>
    apiRequest<ModelsResponse>('/v1/models', { apiKey, signal }),

  routingCatalog: (apiKey: string, signal?: AbortSignal) =>
    apiRequest<RoutingCatalogResponse>('/dashboard/routing-catalog', {
      apiKey,
      signal,
    }),

  routingConfig: (apiKey: string, signal?: AbortSignal) =>
    apiRequest<RoutingConfigResponse>('/dashboard/routing-config', {
      apiKey,
      signal,
    }),

  updateRoutingConfig: (
    apiKey: string,
    consumer: string,
    category: string,
    complexityTier: string,
    body: RoutingConfigUpdateRequest,
  ) =>
    apiRequest<RoutingConfigRow>(
      `/dashboard/routing-config/${encodeURIComponent(consumer)}/${encodeURIComponent(category)}/${encodeURIComponent(complexityTier)}`,
      { apiKey, method: 'PUT', body },
    ),

  deleteRoutingConfig: (
    apiKey: string,
    consumer: string,
    category: string,
    complexityTier: string,
  ) =>
    apiRequest<RoutingConfigRow>(
      `/dashboard/routing-config/${encodeURIComponent(consumer)}/${encodeURIComponent(category)}/${encodeURIComponent(complexityTier)}`,
      { apiKey, method: 'DELETE' },
    ),

  /**
   * OpenAI-compatible proxy call. The key is deliberately explicit: pitch
   * demos pass a consumer key here without ever replacing the admin session.
   */
  chatCompletion: (
    consumerApiKey: string,
    body: ChatCompletionRequest,
    signal?: AbortSignal,
    transport: ApiTransport = 'default',
  ) =>
    apiRequest<ChatCompletionResponse>('/v1/chat/completions', {
      apiKey: consumerApiKey,
      method: 'POST',
      body,
      signal,
      transport,
    }),
};

/** Pitch-specific wrappers keep the existing dashboard endpoint signatures stable. */
export const pitchEndpoints = {
  health: (apiKey: string, signal?: AbortSignal, transport: ApiTransport = 'default') =>
    apiRequest<HealthResponse>('/health', { apiKey, signal, transport }),
  me: (apiKey: string, signal?: AbortSignal, transport: ApiTransport = 'default') =>
    apiRequest<Me>('/dashboard/me', { apiKey, signal, transport }),
  summary: (apiKey: string, signal?: AbortSignal, transport: ApiTransport = 'default') =>
    apiRequest<Summary>('/dashboard/summary', { apiKey, signal, transport }),
  requests: (
    apiKey: string,
    query: RequestsQuery,
    signal?: AbortSignal,
    transport: ApiTransport = 'default',
  ) =>
    apiRequest<RequestsResponse>('/dashboard/usage/requests', {
      apiKey,
      query: query as Record<string, unknown>,
      signal,
      transport,
    }),
  budgets: (apiKey: string, signal?: AbortSignal, transport: ApiTransport = 'default') =>
    apiRequest<BudgetsResponse>('/dashboard/budgets', { apiKey, signal, transport }),
  updateBudget: (
    apiKey: string,
    consumer: string,
    body: BudgetUpdateRequest,
    transport: ApiTransport = 'default',
  ) =>
    apiRequest<BudgetUpdateResponse>(
      `/dashboard/budgets/${encodeURIComponent(consumer)}`,
      { apiKey, method: 'POST', body, transport },
    ),
  savings: (apiKey: string, signal?: AbortSignal, transport: ApiTransport = 'default') =>
    apiRequest<SavingsResponse>('/dashboard/savings', { apiKey, signal, transport }),
  alerts: (apiKey: string, signal?: AbortSignal, transport: ApiTransport = 'default') =>
    apiRequest<AlertsResponse>('/dashboard/alerts', { apiKey, signal, transport }),
  models: (apiKey: string, signal?: AbortSignal, transport: ApiTransport = 'default') =>
    apiRequest<ModelsResponse>('/v1/models', { apiKey, signal, transport }),
  chatCompletion: (
    consumerApiKey: string,
    body: ChatCompletionRequest,
    signal?: AbortSignal,
    transport: ApiTransport = 'default',
  ) => endpoints.chatCompletion(consumerApiKey, body, signal, transport),
};
