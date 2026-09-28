import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { AuditRow, Budget } from '@/api/types';
import { pitchEndpoints } from '@/api/endpoints';
import { formatCurrency, formatPercent } from '@/lib/format';
import { usePitch } from '../PitchContext';
import { readableApiError, sendAndCorrelate } from '../pitchApi';
import type { CorrelatedDemoResult, DemoPhase } from '../pitchTypes';
import { DemoStatus } from './DemoStatus';

type Scenario = 'normal' | 'pressure' | 'block';

const PRESSURE_PROMPT =
  'Design a detailed TypeScript service for reconciling provider invoices. Include validation, idempotency, retries, audit events, observability, failure handling, tests, and a safe rollout plan. Explain the cost and latency trade-offs before presenting the implementation.';

function auditedStage(row: AuditRow | null): Scenario | null {
  if (!row) return null;
  if (row.budget_action === 'blocked') return 'block';
  if (row.budget_action === 'degraded' || row.budget_action === 'warn_only') {
    return 'pressure';
  }
  return 'normal';
}

export function BudgetPressureDemo() {
  const pitch = usePitch();
  const consumer = pitch.consumerKeyState.me?.consumer ?? null;
  const budgets = useQuery({
    queryKey: ['pitch', 'budgets', pitch.mode],
    queryFn: ({ signal }) =>
      pitchEndpoints.budgets(pitch.adminApiKey, signal, pitch.transport),
    staleTime: 5_000,
  });
  const current = budgets.data?.items.find((item) => item.consumer === consumer) ?? null;
  const [phase, setPhase] = useState<DemoPhase>('ready');
  const [result, setResult] = useState<CorrelatedDemoResult | null>(null);
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const busy = phase === 'sending' || phase === 'waiting_for_audit';

  useEffect(() => () => controllerRef.current?.abort(), []);

  function captureOriginal(budget: Budget) {
    pitch.rememberBudget({
      consumer: budget.consumer,
      original: { ...budget },
      mode: pitch.mode,
      changedAt: new Date().toISOString(),
    });
  }

  async function runTrial(label: Scenario) {
    if (!consumer || !pitch.demoConsumerApiKey) {
      throw new Error('Configure and validate a consumer key in preflight first.');
    }
    const trial = await sendAndCorrelate({
      adminApiKey: pitch.adminApiKey,
      consumerApiKey: pitch.demoConsumerApiKey,
      consumer,
      prompt: `${PRESSURE_PROMPT}\n\n[budget-demo-${label}-${Date.now()}]`,
      mode: pitch.mode,
      signal: controllerRef.current?.signal,
      onPhase: setPhase,
    });
    setResult(trial);
    const expectedBlock =
      label === 'block' && trial.audit?.budget_action === 'blocked';
    setPhase(
      trial.chatError && !expectedBlock
        ? 'failed'
        : trial.audit || trial.completion
          ? 'completed'
          : 'failed',
    );
    setMessage(
      trial.audit
        ? `Audit confirms “${trial.audit.budget_action}”.`
        : trial.auditTimedOut
          ? 'The proxy answered, but audit synchronization timed out.'
          : trial.chatError
            ? readableApiError(trial.chatError)
            : null,
    );
    await pitch.invalidateDemoQueries();
    await budgets.refetch();
  }

  async function applyScenario(next: Scenario) {
    if (!current || busy) return;
    controllerRef.current?.abort();
    controllerRef.current = new AbortController();
    setScenario(next);
    setResult(null);
    setMessage(null);
    try {
      if (
        pitch.pendingBudget &&
        pitch.pendingBudget.consumer !== current.consumer
      ) {
        throw new Error(
          `Restore ${pitch.pendingBudget.consumer} before changing another consumer.`,
        );
      }
      captureOriginal(current);
      const original = pitch.pendingBudget?.original ?? current;
      const spend = current.current_spend;
      const body =
        next === 'normal'
          ? {
              // Well below the backend's warning band, independent of seed state.
              budget: Math.max(original.budget, spend * 2 + 1, 1),
              warning_threshold: original.warning_threshold,
            }
          : next === 'pressure'
            ? {
                // Keep headroom while putting usage above the 80% policy band.
                budget: Math.max(0.0001, spend > 0 ? spend * 1.2 : 0.0005),
                warning_threshold: original.warning_threshold,
              }
            : {
                // Positive (schema-valid), but below spend/next estimated charge.
                budget: Math.max(0.000001, spend > 0 ? spend * 0.5 : 0.000001),
                warning_threshold: original.warning_threshold,
              };
      setPhase('sending');
      await pitchEndpoints.updateBudget(
        pitch.adminApiKey,
        current.consumer,
        body,
        pitch.transport,
      );
      await pitch.invalidateDemoQueries();
      await budgets.refetch();
      await runTrial(next);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
      setPhase('failed');
      setMessage(readableApiError(error));
    }
  }

  async function restore() {
    setPhase('sending');
    const ok = await pitch.restorePendingBudget();
    await budgets.refetch();
    setPhase(ok ? 'completed' : 'failed');
    setScenario(null);
    setMessage(pitch.restorationMessage);
  }

  const activeStage = auditedStage(result?.audit ?? null) ?? scenario;

  return (
    <div className="pitch-budget-demo">
      <div className="pitch-budget-topline">
        <div>
          <span>Consumer budget</span>
          <strong>{consumer ?? 'Configure consumer key'}</strong>
        </div>
        <div>
          <span>Current spend</span>
          <strong>{formatCurrency(current?.current_spend)}</strong>
        </div>
        <div>
          <span>Configured limit</span>
          <strong>{formatCurrency(current?.budget)}</strong>
        </div>
        <div>
          <span>Usage</span>
          <strong>{formatPercent(current?.budget_used_pct)}</strong>
        </div>
      </div>

      <div className="pitch-policy-flow" aria-label="Budget policy flow">
        {[
          ['normal', 'Normal', 'allow'],
          ['pressure', 'Pressure', 'warn → degrade'],
          ['block', 'Limit', 'block'],
        ].map(([key, label, action], itemIndex) => (
          <div key={key} className="pitch-policy-step-wrap">
            <div className={`pitch-policy-step${activeStage === key ? ' is-active' : ''}`}>
              <span>0{itemIndex + 1}</span>
              <strong>{label}</strong>
              <small>{action}</small>
            </div>
            {itemIndex < 2 ? <i>→</i> : null}
          </div>
        ))}
      </div>

      <div className="pitch-budget-actions">
        <button type="button" disabled={!current || busy} onClick={() => void applyScenario('normal')}>
          Normal state
        </button>
        <button type="button" disabled={!current || busy} onClick={() => void applyScenario('pressure')}>
          Apply budget pressure
        </button>
        <button className="is-danger" type="button" disabled={!current || busy} onClick={() => void applyScenario('block')}>
          Force block
        </button>
        <button
          className={pitch.pendingBudget ? 'is-restore-pending' : ''}
          type="button"
          disabled={busy}
          onClick={() => void restore()}
        >
          Restore original budget
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            controllerRef.current?.abort();
            setResult(null);
            setScenario(null);
            setMessage(null);
            setPhase('ready');
          }}
        >
          Reset demo
        </button>
      </div>

      {pitch.pendingBudget ? (
        <div className="pitch-restore-banner" role="alert">
          <strong>Configuration changed — restore before leaving.</strong>
          <span>
            Captured {formatCurrency(pitch.pendingBudget.original.budget)} at{' '}
            {formatPercent(pitch.pendingBudget.original.warning_threshold)} warning.
          </span>
          <button type="button" disabled={busy} onClick={() => void restore()}>
            Restore now
          </button>
        </div>
      ) : null}

      <div className="pitch-budget-proof" aria-live="polite">
        <DemoStatus
          phase={phase === 'ready' && pitch.mode === 'rehearsal' ? 'rehearsal' : phase}
          message={message ?? pitch.restorationMessage}
        />
        {result?.audit ? (
          <div className="pitch-budget-audit">
            <div>
              <span>Audited action</span>
              <strong>{result.audit.budget_action}</strong>
            </div>
            <div>
              <span>Selected tier</span>
              <strong>{result.audit.complexity_tier}</strong>
            </div>
            <div>
              <span>Provider / model</span>
              <strong>{result.audit.selected_provider} / {result.audit.selected_model}</strong>
            </div>
            <div>
              <span>HTTP outcome</span>
              <strong>{result.audit.error_code ?? result.audit.status}</strong>
            </div>
          </div>
        ) : null}
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
