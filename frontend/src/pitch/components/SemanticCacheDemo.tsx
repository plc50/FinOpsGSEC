import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { pitchEndpoints } from '@/api/endpoints';
import type { AuditRow } from '@/api/types';
import { formatCurrency, formatLatency } from '@/lib/format';
import { usePitch } from '../PitchContext';
import { readableApiError, sendAndCorrelate } from '../pitchApi';
import type { CorrelatedDemoResult, DemoPhase } from '../pitchTypes';
import { DemoStatus } from './DemoStatus';

function sessionTag() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function isConfirmedHit(audit: AuditRow | null | undefined) {
  return (
    audit?.status === 'semantic_cache_hit' || audit?.usage_source === 'semantic_cache'
  );
}

function CacheRequestCard({
  label,
  result,
  expected,
}: {
  label: string;
  result: CorrelatedDemoResult | null;
  expected: 'miss' | 'hit';
}) {
  const audit = result?.audit;
  const confirmedHit = isConfirmedHit(audit);
  return (
    <article className={`pitch-cache-card${confirmedHit ? ' is-hit' : ''}`}>
      <header>
        <span>{label}</span>
        <strong>
          {!audit ? 'WAITING' : confirmedHit ? 'CACHE HIT' : 'CACHE MISS'}
        </strong>
      </header>
      <dl>
        <div>
          <dt>Served by</dt>
          <dd>{audit ? `${audit.selected_provider} / ${audit.selected_model}` : '—'}</dd>
        </div>
        <div>
          <dt>Actual cost</dt>
          <dd>{formatCurrency(audit?.actual_model_cost)}</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{formatLatency(audit?.latency_ms)}</dd>
        </div>
        <div>
          <dt>{confirmedHit ? 'Avoided cost' : 'Audit source'}</dt>
          <dd>
            {confirmedHit
              ? formatCurrency(audit?.estimated_model_cost)
              : audit?.usage_source ?? '—'}
          </dd>
        </div>
      </dl>
      {audit && expected === 'hit' && !confirmedHit ? (
        <p className="pitch-inline-warning">
          No hit claimed: the audit reports {audit.usage_source}. Use exact replay to retry.
        </p>
      ) : null}
    </article>
  );
}

export function SemanticCacheDemo() {
  const pitch = usePitch();
  const [tag, setTag] = useState(sessionTag);
  const [safeReplay, setSafeReplay] = useState(true);
  const [first, setFirst] = useState<CorrelatedDemoResult | null>(null);
  const [second, setSecond] = useState<CorrelatedDemoResult | null>(null);
  const [phase, setPhase] = useState<DemoPhase>('ready');
  const [message, setMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const consumer = pitch.consumerKeyState.me?.consumer;
  const prompts = useMemo(
    () => ({
      first:
        `Create a concise executive summary of the quarterly AI budget risks. [demo session ${tag}]`,
      second:
        `Summarize the main AI budget risks for the quarter for an executive. [demo session ${tag}]`,
    }),
    [tag],
  );
  const savings = useQuery({
    queryKey: ['pitch', 'cache-savings', pitch.mode],
    queryFn: ({ signal }) =>
      pitchEndpoints.savings(pitch.adminApiKey, signal, pitch.transport),
    staleTime: 5_000,
  });
  const accumulated = savings.data?.mechanisms.find(
    (mechanism) => mechanism.mechanism === 'semantic_cache',
  );
  const busy = phase === 'sending' || phase === 'waiting_for_audit';

  useEffect(() => () => controllerRef.current?.abort(), []);

  async function run(which: 'first' | 'second') {
    if (!pitch.demoConsumerApiKey || !consumer) {
      setPhase('failed');
      setMessage('Configure and validate a consumer key in preflight first.');
      return;
    }
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setMessage(null);
    const prompt = which === 'second' && safeReplay ? prompts.first : prompts[which];
    try {
      const result = await sendAndCorrelate({
        adminApiKey: pitch.adminApiKey,
        consumerApiKey: pitch.demoConsumerApiKey,
        consumer,
        prompt,
        mode: pitch.mode,
        signal: controller.signal,
        onPhase: setPhase,
      });
      if (which === 'first') {
        setFirst(result);
        setSecond(null);
      } else {
        setSecond(result);
      }
      setPhase(
        result.chatError
          ? 'failed'
          : result.audit || result.completion
            ? 'completed'
            : 'failed',
      );
      setMessage(
        result.auditTimedOut
          ? 'Response received, but the audit did not synchronize in time.'
          : result.chatError
            ? readableApiError(result.chatError)
            : which === 'second' && !isConfirmedHit(result.audit)
              ? 'The audit confirms a miss; switch on exact replay and retry.'
              : null,
      );
      await pitch.invalidateDemoQueries();
      await savings.refetch();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setPhase('failed');
      setMessage(readableApiError(error));
    }
  }

  function reset() {
    controllerRef.current?.abort();
    setTag(sessionTag());
    setFirst(null);
    setSecond(null);
    setPhase('ready');
    setMessage(null);
  }

  return (
    <div className="pitch-cache-demo">
      <div className="pitch-cache-prompts">
        <div>
          <span>Prompt A</span>
          <p>{prompts.first}</p>
        </div>
        <div>
          <span>Prompt B · semantic variant</span>
          <p>{prompts.second}</p>
        </div>
      </div>

      <div className="pitch-cache-toolbar">
        <label className="pitch-toggle">
          <input
            type="checkbox"
            checked={safeReplay}
            onChange={(event) => setSafeReplay(event.target.checked)}
          />
          <span>Safe exact replay</span>
          <small>{safeReplay ? 'B sends the exact A payload' : 'B sends the semantic variant'}</small>
        </label>
        <div className="pitch-demo-actions">
          <button className="pitch-primary" type="button" disabled={busy} onClick={() => void run('first')}>
            1 · Send first
          </button>
          <button className="pitch-primary" type="button" disabled={busy || !first} onClick={() => void run('second')}>
            2 · Send equivalent
          </button>
          <button type="button" disabled={busy} onClick={reset}>
            Reset demo
          </button>
        </div>
      </div>

      <div className="pitch-cache-compare" aria-live="polite">
        <CacheRequestCard label="FIRST REQUEST" result={first} expected="miss" />
        <div className="pitch-cache-vs" aria-hidden="true">→</div>
        <CacheRequestCard label="SECOND REQUEST" result={second} expected="hit" />
      </div>

      <div className="pitch-cache-footer">
        <DemoStatus
          phase={phase === 'ready' && pitch.mode === 'rehearsal' ? 'rehearsal' : phase}
          message={message}
        />
        <div>
          <span>Accumulated audited cache savings</span>
          <strong>{formatCurrency(accumulated?.savings, savings.data?.currency)}</strong>
          <small>{accumulated?.requests ?? 0} requests in selected period</small>
        </div>
        {phase === 'failed' ? (
          <button
            className="pitch-recovery"
            type="button"
            onClick={() => {
              void (async () => {
                if (pitch.pendingBudget) await pitch.restorePendingBudget();
                pitch.setMode('rehearsal');
              })();
            }}
          >
            Continue with rehearsal mode
          </button>
        ) : null}
      </div>
    </div>
  );
}
