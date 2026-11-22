/**
 * Typed mock/fixture layer (deliverables: VITE_USE_MOCKS). Mirrors the exact
 * example payloads from API_CONTRACT.md / FRONTEND_CONTEXT.md so the UI is fully
 * demoable and testable without a live backend. Real fetch is the default.
 *
 * Uses ONLY the real demo consumers (§11): equipo-marketing, equipo-producto,
 * equipo-atencion-cliente, admin. No fabricated personas/emails/telemetry.
 */
import type {
  Alert,
  AuditRow,
  Budget,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ConsumerUsage,
  ForecastDetail,
  ForecastSummary,
  Me,
  Model,
  Recommendation,
  RoutingCatalogResponse,
  RoutingConfigResponse,
  RoutingConfigRow,
  SavingsMechanismKey,
  SavingsResponse,
  Summary,
} from './types';

const MOCK_LATENCY_MS = import.meta.env.MODE === 'test' ? 0 : 350;

export function isMockMode(): boolean {
  return (import.meta.env.VITE_USE_MOCKS as string | undefined) === 'true';
}

export const DEMO_CONSUMERS = [
  'equipo-marketing',
  'equipo-producto',
  'equipo-atencion-cliente',
] as const;

// ---- API keys -> auth context (§6.1) ----

const KEY_TO_ME: Record<string, Me> = {
  finops_key_marketing: {
    api_key_id: 'key_marketing',
    api_key_prefix: 'finops_key_...',
    consumer: 'equipo-marketing',
    role: 'consumer',
    can_select_model: false,
    visible_consumers: ['equipo-marketing'],
  },
  finops_key_producto: {
    api_key_id: 'key_producto',
    api_key_prefix: 'finops_key_...',
    consumer: 'equipo-producto',
    role: 'consumer',
    can_select_model: false,
    visible_consumers: ['equipo-producto'],
  },
  finops_key_atencion: {
    api_key_id: 'key_atencion',
    api_key_prefix: 'finops_key_...',
    consumer: 'equipo-atencion-cliente',
    role: 'consumer',
    can_select_model: false,
    visible_consumers: ['equipo-atencion-cliente'],
  },
  finops_key_admin: {
    api_key_id: 'key_admin',
    api_key_prefix: 'finops_key_...',
    consumer: 'admin',
    role: 'admin',
    can_select_model: true,
    visible_consumers: [...DEMO_CONSUMERS],
  },
};

// ---- Per-consumer base figures ----

interface ConsumerFacts {
  current_spend: number;
  budget: number;
  warning_threshold: number;
  projected_spend: number;
  forecast_status: ForecastSummary['forecast_status'];
  forecast_confidence: ForecastSummary['forecast_confidence'];
  requests_count: number;
  degraded_requests: number;
  blocked_requests: number;
  alerts_count: number;
  total_savings: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  weighted_hourly_rate: number;
  budget_exhaustion_at: string | null;
}

const FACTS: Record<string, ConsumerFacts> = {
  'equipo-marketing': {
    current_spend: 8.4,
    budget: 10.0,
    warning_threshold: 0.8,
    projected_spend: 12.8,
    forecast_status: 'projected_over_budget',
    forecast_confidence: 'medium',
    requests_count: 41,
    degraded_requests: 6,
    blocked_requests: 1,
    alerts_count: 2,
    total_savings: 0.0049,
    avg_latency_ms: 1840,
    p95_latency_ms: 3100,
    weighted_hourly_rate: 0.18,
    budget_exhaustion_at: '2026-07-23T18:00:00Z',
  },
  'equipo-producto': {
    current_spend: 21.6,
    budget: 40.0,
    warning_threshold: 0.8,
    projected_spend: 34.2,
    forecast_status: 'at_risk',
    forecast_confidence: 'high',
    requests_count: 58,
    degraded_requests: 4,
    blocked_requests: 0,
    alerts_count: 1,
    total_savings: 0.0102,
    avg_latency_ms: 2120,
    p95_latency_ms: 3800,
    weighted_hourly_rate: 0.32,
    budget_exhaustion_at: '2026-08-02T06:00:00Z',
  },
  'equipo-atencion-cliente': {
    current_spend: 12.75,
    budget: 50.0,
    warning_threshold: 0.8,
    projected_spend: 26.4,
    forecast_status: 'on_track',
    forecast_confidence: 'medium',
    requests_count: 29,
    degraded_requests: 2,
    blocked_requests: 2,
    alerts_count: 1,
    total_savings: 0.0036,
    avg_latency_ms: 1560,
    p95_latency_ms: 2700,
    weighted_hourly_rate: 0.21,
    budget_exhaustion_at: null,
  },
};

const INITIAL_FACTS = Object.fromEntries(
  Object.entries(FACTS).map(([consumer, facts]) => [consumer, { ...facts }]),
) as Record<string, ConsumerFacts>;

interface MockCacheEntry {
  response: ChatCompletionResponse;
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  avoidedCost: number;
}

const semanticResponses = new Map<string, MockCacheEntry>();
let dynamicAlerts: Alert[] = [];
let mockRequestCounter = 0;

function adminFacts(): ConsumerFacts {
  const all = Object.values(FACTS);
  const sum = (f: (c: ConsumerFacts) => number) =>
    all.reduce((acc, c) => acc + f(c), 0);
  return {
    current_spend: round(sum((c) => c.current_spend), 2),
    budget: round(sum((c) => c.budget), 2),
    warning_threshold: 0.8,
    projected_spend: round(sum((c) => c.projected_spend), 2),
    forecast_status: 'projected_over_budget',
    forecast_confidence: 'medium',
    requests_count: sum((c) => c.requests_count),
    degraded_requests: sum((c) => c.degraded_requests),
    blocked_requests: sum((c) => c.blocked_requests),
    alerts_count: sum((c) => c.alerts_count),
    total_savings: round(sum((c) => c.total_savings), 4),
    avg_latency_ms: 1840,
    p95_latency_ms: 3800,
    weighted_hourly_rate: round(sum((c) => c.weighted_hourly_rate), 2),
    budget_exhaustion_at: '2026-07-23T18:00:00Z',
  };
}

function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

// ---- Builders ----

function usedPct(c: ConsumerFacts): number {
  return round(c.current_spend / c.budget, 4);
}

function buildSummary(consumer: string | null): Summary {
  if (consumer === null) {
    const a = adminFacts();
    return {
      scope: 'admin',
      consumer: null,
      current_spend: a.current_spend,
      budget: a.budget,
      budget_used_pct: usedPct(a),
      projected_spend: a.projected_spend,
      forecast_status: a.forecast_status,
      requests_count: a.requests_count,
      degraded_requests: a.degraded_requests,
      blocked_requests: a.blocked_requests,
      alerts_count: a.alerts_count,
      total_savings: a.total_savings,
      currency: 'USD',
    };
  }
  const c = FACTS[consumer];
  return {
    scope: 'consumer',
    consumer,
    current_spend: c.current_spend,
    budget: c.budget,
    budget_used_pct: usedPct(c),
    projected_spend: c.projected_spend,
    forecast_status: c.forecast_status,
    requests_count: c.requests_count,
    degraded_requests: c.degraded_requests,
    blocked_requests: c.blocked_requests,
    alerts_count: c.alerts_count,
    total_savings: c.total_savings,
    currency: 'USD',
  };
}

function buildConsumerUsage(consumer: string): ConsumerUsage {
  const c = FACTS[consumer];
  return {
    consumer,
    current_spend: c.current_spend,
    budget: c.budget,
    budget_used_pct: usedPct(c),
    projected_spend: c.projected_spend,
    forecast_status: c.forecast_status,
    requests_count: c.requests_count,
    degraded_requests: c.degraded_requests,
    blocked_requests: c.blocked_requests,
    total_savings: c.total_savings,
    avg_latency_ms: c.avg_latency_ms,
    p95_latency_ms: c.p95_latency_ms,
  };
}

function buildBudget(consumer: string): Budget {
  const c = FACTS[consumer];
  return {
    consumer,
    budget: c.budget,
    current_spend: c.current_spend,
    budget_used_pct: usedPct(c),
    warning_threshold: c.warning_threshold,
    currency: 'USD',
  };
}

const ROUTING_CATALOG: RoutingCatalogResponse = {
  providers: [
    {
      id: 'openrouter',
      display_name: 'OpenRouter',
      base_url: 'https://openrouter.ai/api/v1',
      supports_chat_completions: true,
      supports_streaming: true,
    },
    {
      id: 'fireworks',
      display_name: 'Fireworks AI',
      base_url: 'https://api.fireworks.ai/inference/v1',
      supports_chat_completions: true,
      supports_streaming: true,
    },
    {
      id: 'tabbyapi',
      display_name: 'TabbyAPI',
      base_url: 'http://127.0.0.1:5000/v1',
      supports_chat_completions: true,
      supports_streaming: true,
    },
  ],
  models: [
    {
      provider: 'openrouter',
      model: 'anthropic/claude-sonnet-5',
      display_name: 'Claude Sonnet 5',
      capabilities: ['text', 'tool_calling', 'structured_outputs'],
      input_price_per_1m_tokens: 3,
      output_price_per_1m_tokens: 15,
    },
    {
      provider: 'fireworks',
      model: 'accounts/fireworks/models/glm-5p1',
      display_name: 'GLM 5.1',
      capabilities: ['text', 'structured_outputs'],
      input_price_per_1m_tokens: 0.2,
      output_price_per_1m_tokens: 0.2,
    },
    {
      provider: 'tabbyapi',
      model: 'gemma-4-12B-it-exl3',
      display_name: 'Gemma 4 12B IT EXL3',
      capabilities: ['text', 'structured_outputs'],
      input_price_per_1m_tokens: 0.06,
      output_price_per_1m_tokens: 0.06,
    },
  ],
  categories: ['qa_internal', 'web_search', 'code_generation', 'misc'],
  complexity_tiers: ['low', 'medium', 'high'],
};

const ROUTE_DEFAULTS: Record<string, { provider: string; model: string }> = {
  'qa_internal/high': { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' },
  'qa_internal/medium': {
    provider: 'fireworks',
    model: 'accounts/fireworks/models/glm-5p1',
  },
  'qa_internal/low': { provider: 'tabbyapi', model: 'gemma-4-12B-it-exl3' },
  'web_search/high': { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' },
  'web_search/medium': {
    provider: 'fireworks',
    model: 'accounts/fireworks/models/glm-5p1',
  },
  'web_search/low': { provider: 'tabbyapi', model: 'gemma-4-12B-it-exl3' },
  'code_generation/high': { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' },
  'code_generation/medium': {
    provider: 'fireworks',
    model: 'accounts/fireworks/models/glm-5p1',
  },
  'code_generation/low': { provider: 'tabbyapi', model: 'gemma-4-12B-it-exl3' },
  'misc/high': { provider: 'openrouter', model: 'anthropic/claude-sonnet-5' },
  'misc/medium': {
    provider: 'fireworks',
    model: 'accounts/fireworks/models/glm-5p1',
  },
  'misc/low': { provider: 'tabbyapi', model: 'gemma-4-12B-it-exl3' },
};

let routingConfigRows: RoutingConfigRow[] = [
  {
    id: 'route_global_misc_medium',
    consumer: 'global',
    category: 'misc',
    complexity_tier: 'medium',
    default_provider: 'fireworks',
    default_model: 'accounts/fireworks/models/glm-5p1',
    configured_provider: 'tabbyapi',
    configured_model: 'gemma-4-12B-it-exl3',
    routing_source: 'admin_config',
    enabled: true,
    model_capabilities: ['text', 'structured_outputs'],
    input_price_per_1m_tokens: 0.06,
    output_price_per_1m_tokens: 0.06,
    updated_at: '2026-07-01T10:00:00Z',
    updated_by_api_key_id: 'key_admin',
  },
];

const CATEGORIES = ['qa_internal', 'web_search', 'code_generation', 'misc'] as const;
const TIERS = ['low', 'medium', 'high'] as const;

const PROMPTS = [
  'Resume este texto en una frase...',
  'Clasifica el sentimiento de estos comentarios...',
  'Genera variantes de copy para la campaña...',
  'Explica el error de este stack trace...',
  'Traduce al ingles el siguiente parrafo...',
  'Devuelve un JSON con los campos extraidos...',
];

let auditCache: AuditRow[] | null = null;

function buildAuditRows(): AuditRow[] {
  if (auditCache) return auditCache;
  const rows: AuditRow[] = [];
  let idx = 0;
  const baseTime = Date.parse('2026-07-01T10:00:00Z');

  for (const consumer of DEMO_CONSUMERS) {
    const c = FACTS[consumer];
    const n = Math.min(c.requests_count, 24);
    for (let i = 0; i < n; i++) {
      idx += 1;
      const isDegraded = i < c.degraded_requests;
      const isBlocked = !isDegraded && i < c.degraded_requests + c.blocked_requests;
      const category = CATEGORIES[i % CATEGORIES.length];
      const tier = TIERS[i % TIERS.length];
      const routeKey = `${category}/${tier}`;
      const route = ROUTE_DEFAULTS[routeKey] ?? ROUTE_DEFAULTS['misc/low'];
      const selectedProvider = isDegraded ? 'tabbyapi' : route.provider;
      const selectedModel = isDegraded ? 'gemma-4-12B-it-exl3' : route.model;
      const start = new Date(baseTime - idx * 47 * 60000).toISOString();
      const latency = 400 + ((idx * 137) % 3200);
      const actualLogical = round(0.00002 + ((idx * 7) % 40) * 0.0000031, 6);
      const estLogical = round(actualLogical * 1.4, 6);

      const budgetAction = isBlocked
        ? 'blocked'
        : isDegraded
          ? 'degraded'
          : i % 9 === 4
            ? 'warn_only'
            : 'allow';
      const status = isBlocked
        ? 'blocked'
        : isDegraded
          ? 'degraded'
          : budgetAction === 'warn_only'
            ? 'warn_only'
            : 'completed';

      const baselineCost = isDegraded ? round(actualLogical * 5.1, 6) : null;
      const savings = isDegraded && baselineCost !== null
        ? round(baselineCost - actualLogical, 6)
        : null;
      const savingsRatio =
        isDegraded && baselineCost !== null && baselineCost > 0
          ? round(savings! / baselineCost, 2)
          : null;

      rows.push({
        id: `audit_${String(idx).padStart(3, '0')}`,
        timestamp_started: start,
        timestamp_completed: isBlocked
          ? null
          : new Date(Date.parse(start) + latency).toISOString(),
        consumer,
        requested_model: 'auto',
        selected_provider: selectedProvider,
        selected_model: selectedModel,
        baseline_provider: isDegraded ? 'openrouter' : null,
        baseline_model: isDegraded ? 'anthropic/claude-sonnet-5' : null,
        routing_source: idx % 7 === 0 ? 'admin_config' : 'catalog',
        routing_config_id: idx % 7 === 0 ? 'route_global_misc_medium' : null,
        category,
        original_category:
          consumer === 'equipo-marketing' && category === 'misc' && idx % 9 === 0
            ? 'code_generation'
            : null,
        complexity_score: round(0.12 + ((idx * 13) % 80) / 100, 2),
        complexity_tier: tier,
        required_capabilities:
          category === 'code_generation' ? ['text', 'code'] : ['text'],
        usage_source: idx % 6 === 0 ? 'estimated' : 'provider',
        estimated_prompt_tokens: 100 + ((idx * 11) % 240),
        actual_prompt_tokens: 90 + ((idx * 11) % 230),
        estimated_output_tokens: 200 + ((idx * 17) % 400),
        actual_output_tokens: isBlocked ? 0 : 60 + ((idx * 17) % 380),
        estimated_model_cost: estLogical,
        actual_model_cost: isBlocked ? 0 : actualLogical,
        baseline_model_cost: baselineCost,
        estimated_savings: savings,
        estimated_savings_ratio: savingsRatio,
        routing_overhead_cost: round(((idx * 3) % 5) * 0.0000004, 7),
        backend_cost: round(actualLogical * 0.27, 6),
        budget_charge: isBlocked ? 0 : actualLogical,
        budget_action: budgetAction,
        status,
        error_code: isBlocked ? 'budget_exceeded' : null,
        latency_ms: isBlocked ? 0 : latency,
        prompt_preview: PROMPTS[idx % PROMPTS.length],
        stream: idx % 5 === 0,
        post_stream_budget_overrun: false,
        budget_action_reason: isBlocked
          ? 'Budget exceeded for the current period.'
          : isDegraded
            ? 'Projected over budget; routed to a cheaper compatible model.'
            : null,
      });
    }
  }

  rows.sort(
    (a, b) => Date.parse(b.timestamp_started) - Date.parse(a.timestamp_started),
  );
  auditCache = rows;
  return rows;
}

function buildForecastSummary(consumer: string): ForecastSummary {
  const c = FACTS[consumer];
  return {
    consumer,
    period: 'monthly',
    currency: 'USD',
    spend_so_far: c.current_spend,
    budget: c.budget,
    projected_spend: c.projected_spend,
    forecast_status: c.forecast_status,
    forecast_confidence: c.forecast_confidence,
    weighted_hourly_rate: c.weighted_hourly_rate,
    budget_exhaustion_at: c.budget_exhaustion_at,
  };
}

function buildForecastDetail(consumer: string): ForecastDetail {
  const c = FACTS[consumer];
  const base = buildForecastSummary(consumer);
  const series: ForecastDetail['series'] = [];
  const startHour = Date.parse('2026-07-01T00:00:00Z');
  const rate = c.weighted_hourly_rate;
  const actualBuckets = 14;
  const totalBuckets = 24;
  let cumulative = 0;
  for (let h = 0; h < totalBuckets; h++) {
    const bucketStart = new Date(startHour + h * 3600 * 1000).toISOString();
    if (h < actualBuckets) {
      const inc = rate * (0.6 + ((h * 37) % 100) / 120);
      cumulative += inc;
      series.push({
        bucket_start: bucketStart,
        actual_cost: round(cumulative, 4),
        projected_cost: h === actualBuckets - 1 ? round(cumulative, 4) : null,
      });
    } else {
      cumulative += rate * 1.15;
      series.push({
        bucket_start: bucketStart,
        actual_cost: null,
        projected_cost: round(cumulative, 4),
      });
    }
  }

  return {
    ...base,
    series,
    breakdown_by_category: [
      { category: 'misc', spend_so_far: round(c.current_spend * 0.5, 2), projected_spend: round(c.projected_spend * 0.5, 2) },
      { category: 'qa_internal', spend_so_far: round(c.current_spend * 0.3, 2), projected_spend: round(c.projected_spend * 0.3, 2) },
      { category: 'code_generation', spend_so_far: round(c.current_spend * 0.2, 2), projected_spend: round(c.projected_spend * 0.2, 2) },
    ],
    breakdown_by_model: [
      { selected_model: 'gemma-4-12B-it-exl3', spend_so_far: round(c.current_spend * 0.57, 2), projected_spend: round(c.projected_spend * 0.57, 2) },
      { selected_model: 'accounts/fireworks/models/glm-5p1', spend_so_far: round(c.current_spend * 0.28, 2), projected_spend: round(c.projected_spend * 0.28, 2) },
      { selected_model: 'anthropic/claude-sonnet-5', spend_so_far: round(c.current_spend * 0.15, 2), projected_spend: round(c.projected_spend * 0.15, 2) },
    ],
  };
}

function buildAlerts(): Alert[] {
  return [
    {
      id: 'alert_003',
      type: 'request_blocked',
      consumer: 'equipo-atencion-cliente',
      severity: 'critical',
      title: 'Request blocked: budget exceeded',
      message:
        'A request from equipo-atencion-cliente was blocked because the budget was exceeded.',
      created_at: '2026-07-01T10:12:00Z',
      related_audit_record_id: 'audit_050',
    },
    {
      id: 'alert_001',
      type: 'projection_exceeded',
      consumer: 'equipo-marketing',
      severity: 'warning',
      title: 'Projected spend exceeds budget',
      message:
        'equipo-marketing is projected to spend $12.80 against a $10.00 budget.',
      created_at: '2026-07-01T10:00:00Z',
      related_audit_record_id: null,
    },
    {
      id: 'alert_002',
      type: 'model_degraded',
      consumer: 'equipo-producto',
      severity: 'warning',
      title: 'Model degraded to save cost',
      message:
        'A high-complexity qa_internal task was routed to a cheaper model, saving an estimated $0.00083.',
      created_at: '2026-07-01T09:41:00Z',
      related_audit_record_id: 'audit_017',
    },
    {
      id: 'alert_004',
      type: 'budget_warning',
      consumer: 'equipo-producto',
      severity: 'info',
      title: 'Budget usage above warning threshold',
      message: 'equipo-producto has used more than 80% of a projected budget window.',
      created_at: '2026-07-01T08:30:00Z',
      related_audit_record_id: null,
    },
  ];
}

function buildRecommendations(): Recommendation[] {
  return [
    {
      id: 'rec_001',
      type: 'budget_degradation_recommendation',
      consumer: 'equipo-marketing',
      severity: 'warning',
      message:
        'Marketing esta proyectado por encima del presupuesto. Degradar tareas misc de baja complejidad reduciria el gasto.',
      created_at: '2026-07-01T10:00:00Z',
    },
    {
      id: 'rec_002',
      type: 'projected_over_budget',
      consumer: 'equipo-producto',
      severity: 'info',
      message:
        'Producto se acerca al limite proyectado. Considerar cache de respuestas para tareas qa_internal repetidas.',
      created_at: '2026-07-01T09:20:00Z',
    },
  ];
}

const ADMIN_MODELS: Model[] = [
  { id: 'auto', object: 'model', owned_by: 'finops-proxy' },
  { id: 'openrouter/anthropic/claude-sonnet-5', object: 'model', owned_by: 'openrouter' },
  {
    id: 'fireworks/accounts/fireworks/models/glm-5p1',
    object: 'model',
    owned_by: 'fireworks',
  },
  { id: 'tabbyapi/gemma-4-12B-it-exl3', object: 'model', owned_by: 'tabbyapi' },
];

const CONSUMER_MODELS: Model[] = [
  { id: 'auto', object: 'model', owned_by: 'finops-proxy' },
];

function routeDefault(category: string, tier: string) {
  return ROUTE_DEFAULTS[`${category}/${tier}`] ?? ROUTE_DEFAULTS['misc/low'];
}

function routeKey(consumer: string, category: string, tier: string) {
  return `${consumer}/${category}/${tier}`;
}

function routeModel(provider: string, model: string) {
  return ROUTING_CATALOG.models.find(
    (m) => m.provider === provider && m.model === model,
  );
}

function defaultRoutingRow(
  consumer: string,
  category: string,
  tier: string,
): RoutingConfigRow {
  const def = routeDefault(category, tier);
  const model = routeModel(def.provider, def.model);
  return {
    id: null,
    consumer,
    category: category as RoutingConfigRow['category'],
    complexity_tier: tier as RoutingConfigRow['complexity_tier'],
    default_provider: def.provider,
    default_model: def.model,
    configured_provider: null,
    configured_model: null,
    routing_source: 'catalog',
    enabled: true,
    model_capabilities: model?.capabilities ?? [],
    input_price_per_1m_tokens: model?.input_price_per_1m_tokens ?? null,
    output_price_per_1m_tokens: model?.output_price_per_1m_tokens ?? null,
    updated_at: null,
    updated_by_api_key_id: null,
  };
}

function buildRoutingConfigResponse(consumers: readonly string[]): RoutingConfigResponse {
  const configured = new Map<string, RoutingConfigRow>();
  for (const row of routingConfigRows) {
    configured.set(routeKey(row.consumer, row.category, row.complexity_tier), row);
  }
  const items: RoutingConfigRow[] = [];
  for (const consumer of ['global', ...consumers]) {
    for (const category of ROUTING_CATALOG.categories) {
      for (const tier of ROUTING_CATALOG.complexity_tiers) {
        const key = routeKey(consumer, category, tier);
        items.push(
          configured.get(key) ?? defaultRoutingRow(consumer, category, tier),
        );
      }
    }
  }
  return { items };
}

// ---- Savings (GET /dashboard/savings) ----

const SAVINGS_META: {
  mechanism: SavingsMechanismKey;
  kind: 'measured' | 'estimated';
  label: string;
  description: string;
  share: number;
}[] = [
  {
    mechanism: 'smart_routing',
    kind: 'estimated',
    label: 'Smart routing',
    description:
      'Cost of sending every request to the high tier of its category minus the model the router actually picked.',
    share: 0.56,
  },
  {
    mechanism: 'semantic_cache',
    kind: 'measured',
    label: 'Semantic cache',
    description:
      'Cache hits are charged $0; avoided cost is the served tokens priced at the model that would have answered.',
    share: 0.19,
  },
  {
    mechanism: 'budget_degradation',
    kind: 'measured',
    label: 'Budget degradation',
    description:
      'Savings recorded when the budget policy degraded a request one tier (baseline priced at decision time).',
    share: 0.11,
  },
  {
    mechanism: 'category_downgrade',
    kind: 'measured',
    label: 'Category downgrade',
    description:
      "Requests reclassified by policy to a cheaper category; avoided cost is the original category's route at the same tier.",
    share: 0.09,
  },
  {
    mechanism: 'token_reduction',
    kind: 'measured',
    label: 'Token reduction',
    description:
      "Context tokens not sent to the provider, priced at the selected model's input rate.",
    share: 0.05,
  },
];

function buildSavings(consumers: string[], startDate: string | null): SavingsResponse {
  const end = new Date();
  const start = startDate
    ? new Date(startDate)
    : new Date(end.getTime() - 30 * 86_400_000);
  const days = Math.max(
    1,
    Math.min(90, Math.round((end.getTime() - start.getTime()) / 86_400_000)),
  );

  const perConsumer = consumers
    .filter((c) => FACTS[c])
    .map((c) => {
      const f = FACTS[c];
      const savings = f.total_savings;
      return { consumer: c, actual_spend: f.current_spend, savings, facts: f };
    });

  const actualSpend = perConsumer.reduce((acc, c) => acc + c.actual_spend, 0);
  const totalSavings = perConsumer.reduce((acc, c) => acc + c.savings, 0);
  const baseline = actualSpend + totalSavings;
  const requests = perConsumer.reduce((acc, c) => acc + c.facts.requests_count, 0);
  const cacheHits = Math.max(1, Math.round(requests * 0.16));

  const mechanisms = SAVINGS_META.map((m) => ({
    mechanism: m.mechanism,
    kind: m.kind,
    label: m.label,
    description: m.description,
    savings: totalSavings * m.share,
    requests: Math.max(1, Math.round(requests * m.share)),
    share: m.share,
    extra:
      m.mechanism === 'semantic_cache'
        ? {
            hits: cacheHits,
            tokens_served: cacheHits * 1450,
            avg_hit_latency_ms: 42,
            avg_provider_latency_ms: 1980,
          }
        : m.mechanism === 'token_reduction'
          ? { requests: Math.round(requests * 0.08), tokens_saved: requests * 620 }
          : {},
  }));

  // Deterministic daily series: gentle weekly wave so charts look organic.
  const weights = Array.from({ length: days }, (_, i) => 1 + 0.35 * Math.sin(i / 2.1));
  const weightSum = weights.reduce((a, b) => a + b, 0);
  const series = weights.map((w, i) => {
    const day = new Date(start.getTime() + i * 86_400_000);
    const dayTotal = (totalSavings * w) / weightSum;
    const point: Record<string, number | string> = {
      date: day.toISOString().slice(0, 10),
    };
    for (const m of SAVINGS_META) {
      point[m.mechanism] = Number((dayTotal * m.share).toFixed(6));
    }
    return point as unknown as SavingsResponse['series'][number];
  });

  return {
    start: start.toISOString(),
    end: end.toISOString(),
    currency: 'USD',
    actual_spend: actualSpend,
    baseline_spend: baseline,
    total_savings: totalSavings,
    savings_ratio: baseline > 0 ? totalSavings / baseline : 0,
    projected_monthly_savings: (totalSavings / days) * 30,
    requests_analyzed: requests,
    mechanisms,
    series,
    consumers: perConsumer
      .sort((a, b) => b.savings - a.savings)
      .map((c) => ({
        consumer: c.consumer,
        actual_spend: c.actual_spend,
        savings: c.savings,
        savings_ratio: c.savings / (c.actual_spend + c.savings),
        top_mechanism: 'smart_routing' as const,
        mechanisms: Object.fromEntries(
          SAVINGS_META.map((m) => [m.mechanism, c.savings * m.share]),
        ) as Record<SavingsMechanismKey, number>,
      })),
  };
}

function mockCategory(prompt: string): AuditRow['category'] {
  const value = prompt.toLowerCase();
  if (/python|typescript|function|código|codigo|debug|sql/.test(value)) {
    return 'code_generation';
  }
  if (/search|web|internet|latest|current|buscar/.test(value)) {
    return 'web_search';
  }
  if (/internal|policy|document|knowledge|procedimiento/.test(value)) {
    return 'qa_internal';
  }
  return 'misc';
}

function mockTier(prompt: string): AuditRow['complexity_tier'] {
  if (prompt.length >= 240) return 'high';
  if (prompt.length >= 90) return 'medium';
  return 'low';
}

function modelCost(provider: string, model: string, input: number, output: number) {
  const catalogModel = routeModel(provider, model);
  if (!catalogModel) return 0;
  return round(
    (input * catalogModel.input_price_per_1m_tokens +
      output * catalogModel.output_price_per_1m_tokens) /
      1_000_000,
    8,
  );
}

/** Deterministic semantic grouping for the two rehearsal prompts only. */
function cacheFingerprint(prompt: string): string {
  const normalized = prompt
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  const looksLikeQuarterlyBudget =
    /(quarter|trimestre|quarterly)/.test(normalized) &&
    /(budget|presupuesto)/.test(normalized) &&
    /(risk|riesgo)/.test(normalized) &&
    /(summary|summarize|resumen|resume|executive|ejecutivo)/.test(normalized);
  const sessionTag = normalized.match(/demo session ([a-z0-9]+)/)?.[1] ?? '';
  return looksLikeQuarterlyBudget
    ? `quarterly-budget:${sessionTag}`
    : normalized;
}

function completionText(prompt: string): string {
  if (/python|typescript|function|código|codigo/.test(prompt.toLowerCase())) {
    return 'A cost-aware implementation should validate inputs, isolate provider calls, and record each routing decision for audit.';
  }
  if (/budget|presupuesto/.test(prompt.toLowerCase())) {
    return 'The main budget risks are demand volatility, premium-model overuse, and delayed intervention; monitor usage and enforce thresholds early.';
  }
  return 'FinOpsGSEC routed this request through the lowest-cost compatible path while preserving policy, audit, and usage metadata.';
}

function createMockChat(
  me: Me,
  body: ChatCompletionRequest,
): { response: ChatCompletionResponse | null; audit: AuditRow; blocked: boolean } {
  const prompt = body.messages
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n');
  const startedAt = new Date();
  const category = mockCategory(prompt);
  const tier = mockTier(prompt);
  const baseline = routeDefault(category, tier);
  const promptTokens = Math.max(8, Math.ceil(prompt.length / 4));
  const completionTokens = 34;
  const baselineCost = modelCost(
    baseline.provider,
    baseline.model,
    promptTokens,
    completionTokens,
  );
  const facts = FACTS[me.consumer];
  const fingerprint = `${me.consumer}:${cacheFingerprint(prompt)}`;
  const cached = semanticResponses.get(fingerprint);
  const ratio = facts.current_spend / facts.budget;
  const wouldBlock = facts.current_spend + baselineCost > facts.budget;
  const warned = ratio >= facts.warning_threshold;
  const canDegrade = tier !== 'low';
  const budgetAction: AuditRow['budget_action'] = wouldBlock
    ? 'blocked'
    : warned && canDegrade
      ? 'degraded'
      : warned
        ? 'warn_only'
        : 'allow';

  const tierBelow = tier === 'high' ? 'medium' : 'low';
  const degradedRoute = routeDefault(category, tierBelow);
  const selected = budgetAction === 'degraded' ? degradedRoute : baseline;
  const selectedCost = modelCost(
    selected.provider,
    selected.model,
    promptTokens,
    completionTokens,
  );
  const text = completionText(prompt);
  const response: ChatCompletionResponse = cached?.response ?? {
    id: `chatcmpl-rehearsal-${++mockRequestCounter}`,
    object: 'chat.completion',
    created: Math.floor(startedAt.getTime() / 1000),
    model: `${selected.provider}/${selected.model}`,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content: text },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens,
    },
  };

  const cacheHit = !!cached && !wouldBlock;
  const actualProvider = cacheHit ? cached.provider : selected.provider;
  const actualModel = cacheHit ? cached.model : selected.model;
  const actualCost = cacheHit || wouldBlock ? 0 : selectedCost;
  const latency = wouldBlock ? 16 : cacheHit ? 34 : 720;
  const savedByDegradation =
    budgetAction === 'degraded' ? Math.max(0, baselineCost - selectedCost) : 0;
  const savedByCache = cacheHit ? cached.avoidedCost : 0;
  const id = `pitch_mock_${Date.now()}_${mockRequestCounter}`;

  const audit: AuditRow = {
    id,
    timestamp_started: startedAt.toISOString(),
    timestamp_completed: new Date(startedAt.getTime() + latency).toISOString(),
    consumer: me.consumer,
    requested_model: body.model ?? 'auto',
    selected_provider: actualProvider,
    selected_model: actualModel,
    baseline_provider: budgetAction === 'degraded' ? baseline.provider : null,
    baseline_model: budgetAction === 'degraded' ? baseline.model : null,
    routing_source: 'catalog',
    routing_config_id: null,
    category,
    original_category: null,
    category_source: 'rehearsal_rules',
    complexity_score: tier === 'high' ? 0.82 : tier === 'medium' ? 0.52 : 0.2,
    complexity_tier: tier,
    required_capabilities: ['text'],
    usage_source: cacheHit ? 'semantic_cache' : 'provider',
    estimated_prompt_tokens: promptTokens,
    actual_prompt_tokens: cacheHit ? cached.promptTokens : promptTokens,
    estimated_output_tokens: completionTokens,
    actual_output_tokens: wouldBlock
      ? 0
      : cacheHit
        ? cached.completionTokens
        : completionTokens,
    estimated_model_cost: cacheHit ? cached.avoidedCost : selectedCost,
    actual_model_cost: actualCost,
    baseline_model_cost:
      budgetAction === 'degraded' ? baselineCost : null,
    estimated_savings:
      savedByDegradation > 0 ? savedByDegradation : null,
    estimated_savings_ratio:
      savedByDegradation > 0 && baselineCost > 0
        ? savedByDegradation / baselineCost
        : null,
    routing_overhead_cost: 0,
    backend_cost: 0,
    budget_charge: actualCost,
    budget_action: budgetAction,
    status: wouldBlock
      ? 'blocked'
      : cacheHit
        ? 'semantic_cache_hit'
        : budgetAction === 'degraded'
          ? 'degraded'
          : budgetAction === 'warn_only'
            ? 'warn_only'
            : 'completed',
    error_code: wouldBlock ? 'budget_exceeded' : null,
    latency_ms: latency,
    prompt_preview: prompt.slice(0, 180),
    stream: false,
    post_stream_budget_overrun: false,
    budget_action_reason: wouldBlock
      ? 'The estimated request charge would exceed the rehearsal budget.'
      : budgetAction === 'degraded'
        ? 'Budget pressure selected the next cheaper compatible tier.'
        : null,
  };

  const currentRows = buildAuditRows();
  auditCache = [audit, ...currentRows];
  facts.requests_count += 1;
  if (wouldBlock) {
    facts.blocked_requests += 1;
    facts.alerts_count += 1;
    dynamicAlerts = [
      {
        id: `alert_${id}`,
        type: 'budget_exceeded',
        consumer: me.consumer,
        severity: 'critical',
        title: 'Budget exceeded',
        message: `${me.consumer} rehearsal request was blocked by the configured limit.`,
        created_at: startedAt.toISOString(),
        related_audit_record_id: id,
      },
      ...dynamicAlerts,
    ];
  } else if (cacheHit) {
    facts.total_savings = round(facts.total_savings + savedByCache, 8);
  } else {
    facts.current_spend = round(facts.current_spend + actualCost, 8);
    facts.total_savings = round(facts.total_savings + savedByDegradation, 8);
    if (budgetAction === 'degraded') {
      facts.degraded_requests += 1;
      facts.alerts_count += 1;
      dynamicAlerts = [
        {
          id: `alert_${id}`,
          type: 'model_degraded',
          consumer: me.consumer,
          severity: 'warning',
          title: 'Model degraded to save budget',
          message: `${me.consumer} rehearsal request moved to one cheaper compatible tier.`,
          created_at: startedAt.toISOString(),
          related_audit_record_id: id,
        },
        ...dynamicAlerts,
      ];
    } else if (budgetAction === 'warn_only') {
      facts.alerts_count += 1;
      dynamicAlerts = [
        {
          id: `alert_${id}`,
          type: 'budget_warning',
          consumer: me.consumer,
          severity: 'warning',
          title: 'Budget warning threshold reached',
          message: `${me.consumer} rehearsal usage is inside its warning band.`,
          created_at: startedAt.toISOString(),
          related_audit_record_id: id,
        },
        ...dynamicAlerts,
      ];
    }
    semanticResponses.set(fingerprint, {
      response,
      provider: selected.provider,
      model: selected.model,
      promptTokens,
      completionTokens,
      avoidedCost: selectedCost,
    });
  }

  return { response: wouldBlock ? null : response, audit, blocked: wouldBlock };
}

/** Reset only mutable rehearsal state; useful for deterministic tests and reruns. */
export function resetMockState(): void {
  for (const [consumer, initial] of Object.entries(INITIAL_FACTS)) {
    Object.assign(FACTS[consumer], initial);
  }
  auditCache = null;
  semanticResponses.clear();
  dynamicAlerts = [];
  mockRequestCounter = 0;
}

// ---- Mock fetch router ----

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function errorResponse(
  status: number,
  code: string,
  message: string,
  param: string | null = null,
  type = 'invalid_request_error',
): Response {
  return json({ error: { message, type, param, code } }, status);
}

function extractKey(init?: RequestInit): string | null {
  const headers = new Headers(init?.headers);
  const auth = headers.get('Authorization');
  if (!auth) return null;
  const match = auth.match(/^Bearer\s+(.+)$/i);
  return match ? match[1] : null;
}

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), MOCK_LATENCY_MS));
}

export async function mockFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const rawUrl = typeof input === 'string' ? input : input.toString();
  const url = new URL(rawUrl, 'http://mock.local');
  const path = url.pathname;
  const params = url.searchParams;
  const method = (init?.method ?? 'GET').toUpperCase();

  if (path === '/health') {
    return delay(
      json({
        status: 'ok',
        contract: 'ai-finops-proxy-dashboard',
        version: '0.3.0-rehearsal',
        mock_providers: true,
      }),
    );
  }

  const key = extractKey(init);
  if (!key) {
    return delay(
      errorResponse(401, 'missing_api_key', 'Missing API key.'),
    );
  }
  const me = KEY_TO_ME[key];
  if (!me) {
    return delay(
      errorResponse(401, 'invalid_api_key', 'Invalid API key.'),
    );
  }
  const isAdmin = me.role === 'admin';

  // /v1/chat/completions — intentionally narrow, deterministic rehearsal.
  if (path === '/v1/chat/completions' && method === 'POST') {
    let body: ChatCompletionRequest;
    try {
      body = JSON.parse(String(init?.body ?? '{}')) as ChatCompletionRequest;
    } catch {
      return delay(errorResponse(400, 'validation_error', 'Invalid JSON body.'));
    }
    if (!Array.isArray(body.messages) || body.messages.length === 0) {
      return delay(
        errorResponse(400, 'validation_error', 'messages must not be empty.', 'messages'),
      );
    }
    const result = createMockChat(me, body);
    if (result.blocked) {
      return delay(
        errorResponse(
          429,
          'budget_exceeded',
          'The request would exceed the configured consumer budget.',
        ),
      );
    }
    return delay(json(result.response));
  }

  // Scope helper: which consumer is this request for, respecting role.
  const requestedConsumer = params.get('consumer');
  if (requestedConsumer && !isAdmin && requestedConsumer !== me.consumer) {
    return delay(
      errorResponse(
        403,
        'forbidden_scope',
        'You do not have access to this consumer scope.',
        'consumer',
      ),
    );
  }

  // /dashboard/me
  if (path === '/dashboard/me') {
    return delay(json(me));
  }

  // /dashboard/summary
  if (path === '/dashboard/summary') {
    if (isAdmin) {
      return delay(json(buildSummary(requestedConsumer)));
    }
    return delay(json(buildSummary(me.consumer)));
  }

  // /dashboard/usage/consumers
  if (path === '/dashboard/usage/consumers') {
    const consumers = isAdmin ? me.visible_consumers : [me.consumer];
    return delay(json({ items: consumers.map(buildConsumerUsage) }));
  }

  // /dashboard/usage/requests
  if (path === '/dashboard/usage/requests') {
    let items = buildAuditRows();
    const scopeConsumers = isAdmin
      ? requestedConsumer
        ? [requestedConsumer]
        : me.visible_consumers
      : [me.consumer];
    items = items.filter((r) => scopeConsumers.includes(r.consumer));

    const category = params.get('category');
    const provider = params.get('provider');
    const model = params.get('model');
    const routingSource = params.get('routing_source');
    const budgetAction = params.get('budget_action');
    const status = params.get('status');
    const usageSource = params.get('usage_source');
    if (category) items = items.filter((r) => r.category === category);
    if (provider) items = items.filter((r) => r.selected_provider === provider);
    if (model) items = items.filter((r) => r.selected_model === model);
    if (routingSource) items = items.filter((r) => r.routing_source === routingSource);
    if (budgetAction) items = items.filter((r) => r.budget_action === budgetAction);
    if (status) items = items.filter((r) => r.status === status);
    if (usageSource) items = items.filter((r) => r.usage_source === usageSource);

    const page = Math.max(1, Number(params.get('page') ?? '1'));
    const pageSize = Math.min(100, Math.max(1, Number(params.get('page_size') ?? '25')));
    const total = items.length;
    const start = (page - 1) * pageSize;
    const paged = items.slice(start, start + pageSize);
    return delay(json({ items: paged, page, page_size: pageSize, total }));
  }

  // /dashboard/routing-catalog
  if (path === '/dashboard/routing-catalog') {
    if (!isAdmin) return delay(errorResponse(403, 'forbidden_scope', 'Admin only.'));
    return delay(json(ROUTING_CATALOG));
  }

  // /dashboard/routing-config
  if (path === '/dashboard/routing-config' && method === 'GET') {
    if (!isAdmin) return delay(errorResponse(403, 'forbidden_scope', 'Admin only.'));
    return delay(json(buildRoutingConfigResponse(me.visible_consumers)));
  }

  if (path.startsWith('/dashboard/routing-config/') && isAdmin) {
    const parts = path.split('/').map(decodeURIComponent);
    const [consumer, category, tier] = parts.slice(-3);
    const key = `${consumer}/${category}/${tier}`;
    if (method === 'PUT') {
      const body = JSON.parse(String(init?.body ?? '{}')) as {
        provider: string;
        model: string;
        enabled: boolean;
      };
      const model = routeModel(body.provider, body.model);
      if (!model) {
        return delay(errorResponse(400, 'validation_error', 'Unknown model.', 'model'));
      }
      const def = routeDefault(category, tier);
      const row: RoutingConfigRow = {
        id: `route_${key.replaceAll('/', '_')}`,
        consumer,
        category: category as RoutingConfigRow['category'],
        complexity_tier: tier as RoutingConfigRow['complexity_tier'],
        default_provider: def.provider,
        default_model: def.model,
        configured_provider: body.provider,
        configured_model: body.model,
        routing_source: 'admin_config',
        enabled: body.enabled,
        model_capabilities: model.capabilities,
        input_price_per_1m_tokens: model.input_price_per_1m_tokens,
        output_price_per_1m_tokens: model.output_price_per_1m_tokens,
        updated_at: new Date().toISOString(),
        updated_by_api_key_id: me.api_key_id,
      };
      routingConfigRows = [
        ...routingConfigRows.filter(
          (r) =>
            !(
              r.consumer === consumer &&
              r.category === category &&
              r.complexity_tier === tier
            ),
        ),
        row,
      ];
      return delay(json(row));
    }
    if (method === 'DELETE') {
      routingConfigRows = routingConfigRows.filter(
        (r) =>
          !(
            r.consumer === consumer &&
            r.category === category &&
            r.complexity_tier === tier
          ),
      );
      return delay(json(defaultRoutingRow(consumer, category, tier)));
    }
  }

  // /dashboard/budgets (GET)
  if (path === '/dashboard/budgets' && method === 'GET') {
    const consumers = isAdmin ? me.visible_consumers : [me.consumer];
    return delay(json({ items: consumers.map(buildBudget) }));
  }

  // /dashboard/budgets/{consumer} (POST) — admin only
  if (path.startsWith('/dashboard/budgets/') && method === 'POST') {
    if (!isAdmin) {
      return delay(
        errorResponse(403, 'forbidden_scope', 'Only admins may update budgets.', 'consumer'),
      );
    }
    const consumer = decodeURIComponent(path.split('/').pop() ?? '');
    if (!FACTS[consumer]) {
      return delay(errorResponse(404, 'not_found', 'Unknown consumer.', 'consumer'));
    }
    let body: { budget?: number; warning_threshold?: number } = {};
    try {
      body = init?.body ? JSON.parse(init.body as string) : {};
    } catch {
      body = {};
    }
    const budget = Number(body.budget);
    const warning = Number(body.warning_threshold);
    if (!(budget > 0)) {
      return delay(
        errorResponse(400, 'validation_error', 'budget must be greater than 0.', 'budget'),
      );
    }
    if (!(warning >= 0.1 && warning <= 0.99)) {
      return delay(
        errorResponse(
          400,
          'validation_error',
          'warning_threshold must be between 0.1 and 0.99.',
          'warning_threshold',
        ),
      );
    }
    FACTS[consumer].budget = budget;
    FACTS[consumer].warning_threshold = warning;
    return delay(
      json({ consumer, budget, warning_threshold: warning, currency: 'USD' }),
    );
  }

  // /dashboard/savings
  if (path === '/dashboard/savings') {
    const requested = params.get('consumer');
    if (requested && !me.visible_consumers.includes(requested)) {
      return delay(
        errorResponse(403, 'forbidden_scope', 'Forbidden consumer scope.', 'consumer'),
      );
    }
    const consumers = requested
      ? [requested]
      : isAdmin
        ? me.visible_consumers
        : [me.consumer];
    return delay(json(buildSavings(consumers, params.get('start_date'))));
  }

  // /dashboard/forecast (list)
  if (path === '/dashboard/forecast') {
    const consumers = isAdmin ? me.visible_consumers : [me.consumer];
    return delay(json({ items: consumers.map(buildForecastSummary) }));
  }

  // /dashboard/forecast/{consumer}
  if (path.startsWith('/dashboard/forecast/')) {
    const consumer = decodeURIComponent(path.split('/').pop() ?? '');
    if (!isAdmin && consumer !== me.consumer) {
      return delay(
        errorResponse(403, 'forbidden_scope', 'Forbidden consumer scope.', 'consumer'),
      );
    }
    if (!FACTS[consumer]) {
      return delay(errorResponse(404, 'not_found', 'Unknown consumer.', 'consumer'));
    }
    return delay(json(buildForecastDetail(consumer)));
  }

  // /dashboard/alerts
  if (path === '/dashboard/alerts') {
    let items = [...dynamicAlerts, ...buildAlerts()];
    const scope = isAdmin
      ? requestedConsumer
        ? [requestedConsumer]
        : me.visible_consumers
      : [me.consumer];
    items = items.filter((a) => scope.includes(a.consumer));
    const severity = params.get('severity');
    const type = params.get('type');
    if (severity) items = items.filter((a) => a.severity === severity);
    if (type) items = items.filter((a) => a.type === type);
    items.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
    return delay(json({ items }));
  }

  // /dashboard/recommendations
  if (path === '/dashboard/recommendations') {
    let items = buildRecommendations();
    const scope = isAdmin
      ? requestedConsumer
        ? [requestedConsumer]
        : me.visible_consumers
      : [me.consumer];
    items = items.filter((r) => scope.includes(r.consumer));
    return delay(json({ items }));
  }

  // /v1/models
  if (path === '/v1/models') {
    return delay(json({ object: 'list', data: isAdmin ? ADMIN_MODELS : CONSUMER_MODELS }));
  }

  return delay(errorResponse(404, 'not_found', `No mock route for ${path}.`));
}
