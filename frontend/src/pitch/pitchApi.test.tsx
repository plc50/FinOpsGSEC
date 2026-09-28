import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/api/client';
import { pitchEndpoints } from '@/api/endpoints';
import { resetMockState } from '@/api/mocks';
import type { ChatCompletionResponse, RequestsResponse } from '@/api/types';
import { RoutingDecision } from './components/RoutingDecision';
import {
  restoreBudgetChange,
  sendAndCorrelate,
  waitForNewAudit,
} from './pitchApi';

const ADMIN_KEY = 'finops_key_admin';
const CONSUMER_KEY = 'finops_key_producto';
const CONSUMER = 'equipo-producto';

const COMPLETION: ChatCompletionResponse = {
  id: 'chatcmpl-test',
  object: 'chat.completion',
  created: 1,
  model: 'test/model',
  choices: [
    {
      index: 0,
      message: { role: 'assistant', content: 'Safe response' },
      finish_reason: 'stop',
    },
  ],
};

describe('pitch API orchestration', () => {
  beforeEach(() => resetMockState());

  it('correlates a successful completion and renders its audited routing result', async () => {
    const result = await sendAndCorrelate({
      adminApiKey: ADMIN_KEY,
      consumerApiKey: CONSUMER_KEY,
      consumer: CONSUMER,
      prompt: `Write a TypeScript cost function. [success-${Date.now()}]`,
      mode: 'rehearsal',
    });
    expect(result.completion).not.toBeNull();
    expect(result.audit).not.toBeNull();
    render(<RoutingDecision audit={result.audit!} />);
    expect(screen.getByText(result.audit!.id)).toBeInTheDocument();
    expect(screen.getAllByText(result.audit!.selected_provider).length).toBeGreaterThan(0);
  });

  it('returns after an audit timeout while preserving the chat response', async () => {
    const emptyRequests = vi.fn(async (): Promise<RequestsResponse> => ({
      items: [],
      page: 1,
      page_size: 50,
      total: 0,
    }));
    const result = await sendAndCorrelate({
      adminApiKey: ADMIN_KEY,
      consumerApiKey: CONSUMER_KEY,
      consumer: CONSUMER,
      prompt: 'A request whose audit is delayed',
      mode: 'rehearsal',
      timeoutMs: 5,
      pollMs: 1,
      requestsEndpoint: emptyRequests,
      chatEndpoint: vi.fn(async () => COMPLETION),
    });
    expect(result.completion?.choices[0]?.message.content).toBe('Safe response');
    expect(result.audit).toBeNull();
    expect(result.auditTimedOut).toBe(true);
  });

  it('the rehearsal completion adds a mutable audit record', async () => {
    const before = await pitchEndpoints.requests(
      ADMIN_KEY,
      { consumer: CONSUMER, page: 1, page_size: 100 },
      undefined,
      'mock',
    );
    await pitchEndpoints.chatCompletion(
      CONSUMER_KEY,
      { model: 'auto', messages: [{ role: 'user', content: 'Unique rehearsal prompt' }] },
      undefined,
      'mock',
    );
    const after = await pitchEndpoints.requests(
      ADMIN_KEY,
      { consumer: CONSUMER, page: 1, page_size: 100 },
      undefined,
      'mock',
    );
    expect(after.total).toBe(before.total + 1);
    expect(after.items[0]?.id).toMatch(/^pitch_mock_/);
  });

  it('restores the exact original configurable budget values', async () => {
    const original = (
      await pitchEndpoints.budgets(ADMIN_KEY, undefined, 'mock')
    ).items.find((budget) => budget.consumer === CONSUMER)!;
    await pitchEndpoints.updateBudget(
      ADMIN_KEY,
      CONSUMER,
      { budget: 1.23, warning_threshold: 0.51 },
      'mock',
    );
    await restoreBudgetChange(ADMIN_KEY, {
      consumer: CONSUMER,
      original: { ...original },
      mode: 'rehearsal',
      changedAt: new Date().toISOString(),
    });
    const restored = (
      await pitchEndpoints.budgets(ADMIN_KEY, undefined, 'mock')
    ).items.find((budget) => budget.consumer === CONSUMER)!;
    expect(restored.budget).toBe(original.budget);
    expect(restored.warning_threshold).toBe(original.warning_threshold);
  });

  it('distinguishes a cache miss from a confirmed cache hit', async () => {
    const prompt = `Create an executive quarterly AI budget risk summary. [demo session cache${Date.now()}]`;
    const first = await sendAndCorrelate({
      adminApiKey: ADMIN_KEY,
      consumerApiKey: CONSUMER_KEY,
      consumer: CONSUMER,
      prompt,
      mode: 'rehearsal',
    });
    const second = await sendAndCorrelate({
      adminApiKey: ADMIN_KEY,
      consumerApiKey: CONSUMER_KEY,
      consumer: CONSUMER,
      prompt,
      mode: 'rehearsal',
    });
    expect(first.audit?.usage_source).not.toBe('semantic_cache');
    expect(second.audit?.usage_source).toBe('semantic_cache');
    expect(second.audit?.status).toBe('semantic_cache_hit');
    expect(second.audit?.actual_model_cost).toBe(0);
  });

  it('rehearses warn, degrade and block budget outcomes deterministically', async () => {
    const budget = (
      await pitchEndpoints.budgets(ADMIN_KEY, undefined, 'mock')
    ).items.find((item) => item.consumer === CONSUMER)!;
    await pitchEndpoints.updateBudget(
      ADMIN_KEY,
      CONSUMER,
      {
        budget: budget.current_spend * 1.2,
        warning_threshold: budget.warning_threshold,
      },
      'mock',
    );
    const warned = await sendAndCorrelate({
      adminApiKey: ADMIN_KEY,
      consumerApiKey: CONSUMER_KEY,
      consumer: CONSUMER,
      prompt: `Short unique request ${Date.now()}`,
      mode: 'rehearsal',
    });
    const degraded = await sendAndCorrelate({
      adminApiKey: ADMIN_KEY,
      consumerApiKey: CONSUMER_KEY,
      consumer: CONSUMER,
      prompt:
        `Write a comprehensive TypeScript implementation with validation, retries, observability, audit records, performance analysis, migration steps, rollback criteria, security controls and a complete test strategy. Explain every architectural trade-off. [${Date.now()}]`,
      mode: 'rehearsal',
    });
    await pitchEndpoints.updateBudget(
      ADMIN_KEY,
      CONSUMER,
      { budget: 0.000001, warning_threshold: budget.warning_threshold },
      'mock',
    );
    const blocked = await sendAndCorrelate({
      adminApiKey: ADMIN_KEY,
      consumerApiKey: CONSUMER_KEY,
      consumer: CONSUMER,
      prompt: `Blocked unique request ${Date.now()}`,
      mode: 'rehearsal',
    });
    expect(warned.audit?.budget_action).toBe('warn_only');
    expect(degraded.audit?.budget_action).toBe('degraded');
    expect(blocked.audit?.budget_action).toBe('blocked');
    expect(blocked.chatError).toBeInstanceOf(ApiError);
  });

  it('keeps API errors recoverable instead of throwing away presentation state', async () => {
    const result = await sendAndCorrelate({
      adminApiKey: ADMIN_KEY,
      consumerApiKey: CONSUMER_KEY,
      consumer: CONSUMER,
      prompt: 'Recoverable failure',
      mode: 'rehearsal',
      timeoutMs: 3,
      pollMs: 1,
      requestsEndpoint: vi.fn(async (): Promise<RequestsResponse> => ({
        items: [],
        page: 1,
        page_size: 50,
        total: 0,
      })),
      chatEndpoint: vi.fn(async () => {
        throw new ApiError({
          status: 503,
          code: 'provider_error',
          message: 'Provider unavailable',
        });
      }),
    });
    expect(result.chatError).toBeInstanceOf(ApiError);
    expect(result.auditTimedOut).toBe(true);
    expect(result.completion).toBeNull();
  });

  it('polling identifies only IDs created after the request snapshot', async () => {
    const seed = await sendAndCorrelate({
      adminApiKey: ADMIN_KEY,
      consumerApiKey: CONSUMER_KEY,
      consumer: CONSUMER,
      prompt: `Seed ${Date.now()}`,
      mode: 'rehearsal',
    });
    const found = await waitForNewAudit({
      adminApiKey: ADMIN_KEY,
      consumer: CONSUMER,
      beforeIds: new Set(),
      startedAt: Date.parse(seed.audit!.timestamp_started) - 1,
      mode: 'rehearsal',
      timeoutMs: 20,
    });
    expect(found?.id).toBe(seed.audit?.id);
  });
});
