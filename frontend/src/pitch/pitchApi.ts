import { ApiError } from '@/api/client';
import { pitchEndpoints, type ApiTransport } from '@/api/endpoints';
import type {
  AuditRow,
  BudgetUpdateRequest,
  ChatCompletionRequest,
} from '@/api/types';
import type {
  CorrelatedDemoResult,
  DemoMode,
  DemoPhase,
  PendingBudgetChange,
} from './pitchTypes';

export function transportForMode(mode: DemoMode): ApiTransport {
  return mode === 'rehearsal' ? 'mock' : 'live';
}

export function readableApiError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'The request could not be completed.';
}

export function completionExcerpt(result: CorrelatedDemoResult | null): string {
  const content = result?.completion?.choices[0]?.message.content;
  if (!content) return '';
  return content.length > 360 ? `${content.slice(0, 357)}…` : content;
}

interface WaitForAuditOptions {
  adminApiKey: string;
  consumer?: string;
  beforeIds: Set<string>;
  startedAt: number;
  mode: DemoMode;
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
  fetchRequests?: typeof pitchEndpoints.requests;
  now?: () => number;
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true },
    );
  });
}

/** Polls the admin audit feed; correlation never relies on prompt text. */
export async function waitForNewAudit({
  adminApiKey,
  consumer,
  beforeIds,
  startedAt,
  mode,
  timeoutMs = 9_000,
  pollMs = 450,
  signal,
  fetchRequests = pitchEndpoints.requests,
  now = Date.now,
}: WaitForAuditOptions): Promise<AuditRow | null> {
  const deadline = now() + timeoutMs;
  const transport = transportForMode(mode);
  do {
    const response = await fetchRequests(
      adminApiKey,
      {
        consumer,
        time_range: '1h',
        page: 1,
        page_size: 50,
      },
      signal,
      transport,
    );
    const candidates = response.items
      .filter((row) => !beforeIds.has(row.id))
      .filter((row) => !consumer || row.consumer === consumer)
      // Allow modest client/server clock skew while IDs guarantee newness.
      .filter((row) => Date.parse(row.timestamp_started) >= startedAt - 5_000)
      .sort(
        (left, right) =>
          Date.parse(right.timestamp_started) - Date.parse(left.timestamp_started),
      );
    if (candidates[0]) return candidates[0];
    if (now() >= deadline) break;
    await abortableDelay(Math.min(pollMs, Math.max(0, deadline - now())), signal);
  } while (now() <= deadline);
  return null;
}

interface SendAndCorrelateOptions {
  adminApiKey: string;
  consumerApiKey: string;
  consumer?: string;
  prompt: string;
  mode: DemoMode;
  maxTokens?: number;
  timeoutMs?: number;
  pollMs?: number;
  signal?: AbortSignal;
  onPhase?: (phase: DemoPhase) => void;
  requestsEndpoint?: typeof pitchEndpoints.requests;
  chatEndpoint?: typeof pitchEndpoints.chatCompletion;
  now?: () => number;
}

export async function sendAndCorrelate({
  adminApiKey,
  consumerApiKey,
  consumer,
  prompt,
  mode,
  maxTokens = 180,
  timeoutMs,
  pollMs,
  signal,
  onPhase,
  requestsEndpoint = pitchEndpoints.requests,
  chatEndpoint = pitchEndpoints.chatCompletion,
  now = Date.now,
}: SendAndCorrelateOptions): Promise<CorrelatedDemoResult> {
  const transport = transportForMode(mode);
  let beforeIds = new Set<string>();
  try {
    const before = await requestsEndpoint(
      adminApiKey,
      { consumer, time_range: '1h', page: 1, page_size: 50 },
      signal,
      transport,
    );
    beforeIds = new Set(before.items.map((row) => row.id));
  } catch {
    // Audit may be temporarily unavailable. The proxy request can still run,
    // and a later poll can recover using the start timestamp.
  }

  const startedAt = now();
  const body: ChatCompletionRequest = {
    model: 'auto',
    messages: [{ role: 'user', content: prompt }],
    max_tokens: maxTokens,
    stream: false,
  };
  let completion: CorrelatedDemoResult['completion'] = null;
  let chatError: CorrelatedDemoResult['chatError'] = null;
  onPhase?.('sending');
  try {
    completion = await chatEndpoint(
      consumerApiKey,
      body,
      signal,
      transport,
    );
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    chatError = error instanceof Error ? error : new Error(readableApiError(error));
  }

  onPhase?.('waiting_for_audit');
  let audit: AuditRow | null = null;
  try {
    audit = await waitForNewAudit({
      adminApiKey,
      consumer,
      beforeIds,
      startedAt,
      mode,
      timeoutMs,
      pollMs,
      signal,
      fetchRequests: requestsEndpoint,
      now,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
  }

  return {
    completion,
    audit,
    chatError,
    auditTimedOut: audit === null,
  };
}

export async function restoreBudgetChange(
  adminApiKey: string,
  pending: PendingBudgetChange,
  updateBudget: typeof pitchEndpoints.updateBudget = pitchEndpoints.updateBudget,
): Promise<void> {
  const body: BudgetUpdateRequest = {
    budget: pending.original.budget,
    warning_threshold: pending.original.warning_threshold,
  };
  await updateBudget(
    adminApiKey,
    pending.consumer,
    body,
    transportForMode(pending.mode),
  );
}
