/**
 * Typed mirror of the shared API contract (API_CONTRACT.md §3, §6 and
 * FRONTEND_CONTEXT.md §6). This is the single source of truth for enums and
 * payload shapes used across the app.
 */

// ---- Enums (API_CONTRACT §3) ----

export type Role = 'admin' | 'consumer';

export type Category =
  | 'qa_internal'
  | 'web_search'
  | 'code_generation'
  | 'misc';

export type ComplexityTier = 'low' | 'medium' | 'high';

export type BudgetAction = 'allow' | 'warn_only' | 'degraded' | 'blocked';

export type RequestStatus =
  | 'completed'
  | 'degraded'
  | 'blocked'
  | 'warn_only'
  | 'semantic_cache_hit'
  | 'cancelled_by_client'
  | 'provider_error'
  | 'provider_stream_error';

export type UsageSource = 'provider' | 'estimated' | 'semantic_cache';

export type ForecastStatus = 'on_track' | 'at_risk' | 'projected_over_budget';

export type ForecastConfidence = 'low' | 'medium' | 'high';

export type Severity = 'info' | 'warning' | 'critical';

export type AlertType =
  | 'budget_warning'
  | 'budget_exceeded'
  | 'expensive_request'
  | 'cost_spike'
  | 'projection_exceeded'
  | 'model_degraded'
  | 'category_downgraded'
  | 'request_blocked'
  | 'post_stream_budget_overrun'
  | 'provider_error';

export type RecommendationType =
  | 'projected_over_budget'
  | 'budget_degradation_recommendation';

// ---- Error contract (API_CONTRACT §4) ----

export type ErrorCode =
  | 'missing_api_key'
  | 'invalid_api_key'
  | 'model_selection_not_allowed'
  | 'no_compatible_model'
  | 'budget_exceeded'
  | 'provider_error'
  | 'forbidden_scope'
  | 'validation_error'
  | (string & {});

export interface ApiErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: ErrorCode;
  };
}

// ---- Auth context (§6.1) ----

export interface Me {
  api_key_id: string;
  api_key_prefix: string;
  consumer: string;
  role: Role;
  can_select_model: boolean;
  visible_consumers: string[];
}

// ---- Summary (§6.2) ----

export interface Summary {
  scope: 'admin' | 'consumer';
  consumer: string | null;
  current_spend: number;
  budget: number;
  budget_used_pct: number;
  projected_spend: number;
  forecast_status: ForecastStatus;
  requests_count: number;
  degraded_requests: number;
  blocked_requests: number;
  alerts_count: number;
  total_savings: number;
  currency: string;
}

// ---- Audit request row (§6.3 / §6.4) ----

export interface AuditRow {
  id: string;
  timestamp_started: string;
  timestamp_completed: string | null;
  consumer: string;
  requested_model: string;
  selected_provider: string;
  selected_model: string;
  baseline_provider: string | null;
  baseline_model: string | null;
  routing_source: 'catalog' | 'admin_config';
  routing_config_id: string | null;
  category: Category;
  /** Set when a per-consumer policy reclassified the request to a cheaper category. */
  original_category: Category | null;
  category_source?: string | null;
  complexity_score: number;
  complexity_tier: ComplexityTier;
  required_capabilities: string[];
  usage_source: UsageSource;
  estimated_prompt_tokens: number;
  actual_prompt_tokens: number;
  estimated_output_tokens: number;
  actual_output_tokens: number;
  estimated_model_cost: number;
  actual_model_cost: number;
  baseline_model_cost: number | null;
  estimated_savings: number | null;
  estimated_savings_ratio: number | null;
  routing_overhead_cost: number;
  backend_cost: number;
  budget_charge: number;
  budget_action: BudgetAction;
  status: RequestStatus;
  error_code: string | null;
  latency_ms: number;
  prompt_preview: string;
  stream: boolean;
  post_stream_budget_overrun: boolean;
  budget_action_reason?: string | null;
}

export interface RequestsResponse {
  items: AuditRow[];
  page: number;
  page_size: number;
  total: number;
}

// ---- Consumers usage (§6.4 in FE / §6.3 API) ----

export interface ConsumerUsage {
  consumer: string;
  current_spend: number;
  budget: number;
  budget_used_pct: number;
  projected_spend: number;
  forecast_status: ForecastStatus;
  requests_count: number;
  degraded_requests: number;
  blocked_requests: number;
  total_savings: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
}

export interface ConsumersResponse {
  items: ConsumerUsage[];
}

// ---- Forecast (§6.5 / API §6.7, §6.8) ----

export interface ForecastSeriesPoint {
  bucket_start: string;
  actual_cost: number | null;
  projected_cost: number | null;
}

export interface ForecastBreakdownByCategory {
  category: Category;
  spend_so_far: number;
  projected_spend: number;
}

export interface ForecastBreakdownByModel {
  selected_model: string;
  spend_so_far: number;
  projected_spend: number;
}

export interface ForecastSummary {
  consumer: string;
  period: string;
  currency: string;
  spend_so_far: number;
  budget: number;
  projected_spend: number;
  forecast_status: ForecastStatus;
  forecast_confidence: ForecastConfidence;
  weighted_hourly_rate: number;
  budget_exhaustion_at: string | null;
}

export interface ForecastDetail extends ForecastSummary {
  series: ForecastSeriesPoint[];
  breakdown_by_category: ForecastBreakdownByCategory[];
  breakdown_by_model: ForecastBreakdownByModel[];
}

export interface ForecastListResponse {
  items: ForecastSummary[];
}

// ---- Savings (GET /dashboard/savings) ----

export type SavingsKind = 'measured' | 'estimated';

export type SavingsMechanismKey =
  | 'smart_routing'
  | 'semantic_cache'
  | 'budget_degradation'
  | 'category_downgrade'
  | 'token_reduction';

export interface SavingsMechanism {
  mechanism: SavingsMechanismKey;
  kind: SavingsKind;
  label: string;
  description: string;
  savings: number;
  requests: number;
  /** Fraction of total savings attributable to this mechanism (0..1). */
  share: number;
  extra: {
    hits?: number;
    tokens_served?: number;
    avg_hit_latency_ms?: number | null;
    avg_provider_latency_ms?: number | null;
    requests?: number;
    tokens_saved?: number;
  };
}

export interface SavingsSeriesPoint {
  date: string;
  smart_routing: number;
  semantic_cache: number;
  budget_degradation: number;
  category_downgrade: number;
  token_reduction: number;
}

export interface SavingsConsumerRow {
  consumer: string;
  actual_spend: number;
  savings: number;
  savings_ratio: number;
  top_mechanism: SavingsMechanismKey | null;
  mechanisms: Record<SavingsMechanismKey, number>;
}

export interface SavingsResponse {
  start: string;
  end: string;
  currency: string;
  actual_spend: number;
  baseline_spend: number;
  total_savings: number;
  savings_ratio: number;
  projected_monthly_savings: number;
  requests_analyzed: number;
  mechanisms: SavingsMechanism[];
  series: SavingsSeriesPoint[];
  consumers: SavingsConsumerRow[];
}

// ---- Alerts (§6.6) ----

export interface Alert {
  id: string;
  type: AlertType;
  consumer: string;
  severity: Severity;
  title: string;
  message: string;
  created_at: string;
  related_audit_record_id: string | null;
}

export interface AlertsResponse {
  items: Alert[];
}

// ---- Recommendations (§6.7) ----

export interface Recommendation {
  id: string;
  type: RecommendationType;
  consumer: string;
  severity: Severity;
  message: string;
  created_at: string;
}

export interface RecommendationsResponse {
  items: Recommendation[];
}

// ---- Budgets (§6.8) ----

export interface Budget {
  consumer: string;
  budget: number;
  current_spend: number;
  budget_used_pct: number;
  warning_threshold: number;
  currency: string;
}

export interface BudgetsResponse {
  items: Budget[];
}

export interface BudgetUpdateRequest {
  budget: number;
  warning_threshold: number;
}

export interface BudgetUpdateResponse {
  consumer: string;
  budget: number;
  warning_threshold: number;
  currency: string;
}

// ---- Routing catalog/config (§8) ----

export interface RoutingProvider {
  id: string;
  display_name: string;
  base_url: string;
  supports_chat_completions: boolean;
  supports_streaming: boolean;
}

export interface RoutingModel {
  provider: string;
  model: string;
  display_name: string;
  capabilities: string[];
  input_price_per_1m_tokens: number;
  output_price_per_1m_tokens: number;
}

export interface RoutingCatalogResponse {
  providers: RoutingProvider[];
  models: RoutingModel[];
  categories: Category[];
  complexity_tiers: ComplexityTier[];
}

export interface RoutingConfigRow {
  id: string | null;
  consumer: string;
  category: Category;
  complexity_tier: ComplexityTier;
  default_provider: string | null;
  default_model: string | null;
  configured_provider: string | null;
  configured_model: string | null;
  routing_source: 'catalog' | 'admin_config';
  enabled: boolean;
  model_capabilities: string[];
  input_price_per_1m_tokens: number | null;
  output_price_per_1m_tokens: number | null;
  updated_at: string | null;
  updated_by_api_key_id: string | null;
}

export interface RoutingConfigResponse {
  items: RoutingConfigRow[];
}

export interface RoutingConfigUpdateRequest {
  provider: string;
  model: string;
  enabled: boolean;
}

// ---- Models (§7.6 / API §5.1) ----

export interface Model {
  id: string;
  object: 'model';
  owned_by: string;
}

export interface ModelsResponse {
  object: 'list';
  data: Model[];
}

// ---- OpenAI-compatible chat (§2) ----

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | (string & {});
  content: string;
}

export interface ChatCompletionRequest {
  model?: string;
  messages: ChatMessage[];
  max_tokens?: number;
  stream?: false;
  temperature?: number;
  user?: string;
}

export interface ChatCompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: ChatMessage;
    finish_reason: string | null;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export interface HealthResponse {
  status: string;
  contract: string;
  version: string;
  /** Present on current backends; older deployments may omit it. */
  mock_providers?: boolean;
}

// ---- Query param helpers ----

export type TimeRange = '1h' | '24h' | '7d' | '30d';

export interface RequestsQuery {
  consumer?: string;
  category?: Category;
  provider?: string;
  model?: string;
  routing_source?: 'catalog' | 'admin_config';
  budget_action?: BudgetAction;
  status?: RequestStatus;
  usage_source?: UsageSource;
  time_range?: TimeRange;
  page?: number;
  page_size?: number;
}
