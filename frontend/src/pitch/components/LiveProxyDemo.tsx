import { useEffect, useRef, useState } from 'react';
import { ApiError } from '@/api/client';
import {
  DEMO_KEYS_ENABLED,
  KNOWN_DEMO_CONSUMERS,
  usePitch,
} from '../PitchContext';
import {
  completionExcerpt,
  readableApiError,
  sendAndCorrelate,
} from '../pitchApi';
import type { CorrelatedDemoResult, DemoPhase } from '../pitchTypes';
import { DemoStatus } from './DemoStatus';
import { RoutingDecision } from './RoutingDecision';

const PROMPTS = [
  {
    label: 'Quick copy',
    value: 'Write three concise subject lines for a product launch email.',
  },
  {
    label: 'Internal Q&A',
    value:
      'Summarize this internal policy for a support agent: refunds require approval after 30 days.',
  },
  {
    label: 'Code task',
    value:
      'Write a TypeScript function that groups invoice records by provider and returns validated cost totals.',
  },
  {
    label: 'Complex reasoning',
    value:
      'Design a detailed migration strategy for an AI platform with three providers. Compare failure modes, budget controls, latency trade-offs, audit requirements, staged rollout, rollback criteria, observability, and a test plan before recommending the safest architecture.',
  },
] as const;

export function LiveProxyDemo() {
  const {
    adminApiKey,
    mode,
    setMode,
    demoConsumerApiKey,
    setDemoConsumerApiKey,
    consumerKeyState,
    pendingBudget,
    restorePendingBudget,
    invalidateDemoQueries,
  } = usePitch();
  const [prompt, setPrompt] = useState<string>(PROMPTS[0].value);
  const [phase, setPhase] = useState<DemoPhase>('ready');
  const [result, setResult] = useState<CorrelatedDemoResult | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const canSend =
    prompt.trim().length > 0 &&
    demoConsumerApiKey.length > 0 &&
    consumerKeyState.status === 'ready' &&
    phase !== 'sending' &&
    phase !== 'waiting_for_audit';

  function reset() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setResult(null);
    setPhase('ready');
  }

  async function send() {
    if (!canSend) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setResult(null);
    try {
      const next = await sendAndCorrelate({
        adminApiKey,
        consumerApiKey: demoConsumerApiKey,
        consumer: consumerKeyState.me?.consumer,
        prompt: prompt.trim(),
        mode,
        signal: controller.signal,
        onPhase: setPhase,
      });
      setResult(next);
      setPhase(next.chatError ? 'failed' : 'completed');
      await invalidateDemoQueries();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setResult({
        completion: null,
        audit: null,
        chatError: error instanceof Error ? error : new Error('Request failed.'),
        auditTimedOut: false,
      });
      setPhase('failed');
    }
  }

  const statusMessage =
    result?.auditTimedOut && result.completion
      ? 'Response received; audit has not synchronized yet.'
      : result?.chatError
        ? readableApiError(result.chatError)
        : mode === 'rehearsal' && phase === 'ready'
          ? 'Deterministic frontend fixtures · DEMO DATA'
          : null;

  return (
    <div className="pitch-demo-layout">
      <form
        className="pitch-demo-console"
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
      >
        <div className="pitch-console-head">
          <span>POST /v1/chat/completions</span>
          <span className={mode === 'rehearsal' ? 'pitch-data demo' : 'pitch-data live'}>
            {mode === 'rehearsal' ? 'DEMO DATA' : 'LIVE'}
          </span>
        </div>

        {DEMO_KEYS_ENABLED ? (
          <label className="pitch-field">
            <span>Consumer</span>
            <select
              value={consumerKeyState.me?.consumer ?? ''}
              onChange={(event) => {
                const preset = KNOWN_DEMO_CONSUMERS.find(
                  (entry) => entry.consumer === event.target.value,
                );
                if (preset) setDemoConsumerApiKey(preset.key);
              }}
            >
              <option value="" disabled>
                Select in preflight
              </option>
              {KNOWN_DEMO_CONSUMERS.map((entry) => (
                <option key={entry.consumer} value={entry.consumer}>
                  {entry.label} · {entry.consumer}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="pitch-consumer-line">
            Consumer · {consumerKeyState.me?.consumer ?? 'configure in preflight'}
          </p>
        )}

        <div className="pitch-prompt-chips" aria-label="Prompt presets">
          {PROMPTS.map((item) => (
            <button
              type="button"
              key={item.label}
              onClick={() => setPrompt(item.value)}
              aria-pressed={prompt === item.value}
            >
              {item.label}
            </button>
          ))}
        </div>

        <label className="pitch-field">
          <span>Prompt</span>
          <textarea
            value={prompt}
            rows={5}
            onChange={(event) => setPrompt(event.target.value)}
          />
        </label>

        {consumerKeyState.status !== 'ready' ? (
          <p className="pitch-inline-warning">
            {consumerKeyState.status === 'checking'
              ? 'Checking consumer key…'
              : consumerKeyState.message ?? 'Add a consumer API key in preflight.'}
          </p>
        ) : null}

        <div className="pitch-demo-actions">
          <button className="pitch-primary" type="submit" disabled={!canSend}>
            {phase === 'sending' || phase === 'waiting_for_audit'
              ? 'Working…'
              : 'Send through FinOpsGSEC'}
          </button>
          <button type="button" onClick={reset}>
            Reset demo
          </button>
        </div>
        <DemoStatus
          phase={phase === 'ready' && mode === 'rehearsal' ? 'rehearsal' : phase}
          message={statusMessage}
        />
        {phase === 'failed' ? (
          <button
            className="pitch-recovery"
            type="button"
            onClick={() => {
              void (async () => {
                if (pendingBudget) await restorePendingBudget();
                setMode('rehearsal');
                if (DEMO_KEYS_ENABLED && consumerKeyState.status !== 'ready') {
                  setDemoConsumerApiKey(KNOWN_DEMO_CONSUMERS[0].key);
                }
                setPhase('ready');
              })();
            }}
          >
            Switch to rehearsal mode
          </button>
        ) : null}
      </form>

      <div className="pitch-demo-output" aria-live="polite">
        {result?.audit ? (
          <RoutingDecision audit={result.audit} />
        ) : (
          <div className="pitch-output-placeholder">
            <span>ROUTING DECISION</span>
            <strong>{phase === 'waiting_for_audit' ? 'Synchronizing audit…' : 'Ready'}</strong>
            <p>Verified provider, model, policy, tokens, cost and latency appear here.</p>
          </div>
        )}
        {completionExcerpt(result) ? (
          <blockquote className="pitch-response">
            <span>Model response · excerpt</span>
            {completionExcerpt(result)}
          </blockquote>
        ) : null}
        {result?.chatError instanceof ApiError && result.audit ? (
          <p className="pitch-inline-warning">
            Proxy returned HTTP {result.chatError.status}; the audited policy result is shown above.
          </p>
        ) : null}
      </div>
    </div>
  );
}
