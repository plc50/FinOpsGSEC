import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isMockMode } from '@/api/mocks';
import { pitchEndpoints } from '@/api/endpoints';
import {
  DEMO_KEYS_ENABLED,
  KNOWN_DEMO_CONSUMERS,
  usePitch,
} from '../PitchContext';
import { readableApiError } from '../pitchApi';
import type { CheckTone, DemoMode, PreflightCheck } from '../pitchTypes';

const MODES: Array<{
  value: DemoMode;
  label: string;
  detail: string;
  recommended?: boolean;
}> = [
  {
    value: 'safe-backend',
    label: 'Safe backend',
    detail: 'Real routing, policy, audit and cache; simulated upstream providers.',
    recommended: true,
  },
  {
    value: 'live',
    label: 'Live',
    detail: 'Backend and configured external/local providers.',
  },
  {
    value: 'rehearsal',
    label: 'Frontend rehearsal',
    detail: 'Deterministic mutable fixtures; clearly labelled DEMO DATA.',
  },
];

function CheckIcon({ tone }: { tone: CheckTone }) {
  return <span className={`pitch-check-icon ${tone}`} aria-hidden="true" />;
}

function overallTone(checks: PreflightCheck[]): CheckTone {
  if (checks.some((check) => check.tone === 'red')) return 'red';
  if (checks.some((check) => check.tone === 'yellow')) return 'yellow';
  return 'green';
}

export function PreflightPanel({
  open,
  onClose,
  onResetDeck,
}: {
  open: boolean;
  onClose: () => void;
  onResetDeck: () => void;
}) {
  const pitch = usePitch();
  const [manualKey, setManualKey] = useState('');
  const [checks, setChecks] = useState<PreflightCheck[]>([]);
  const [running, setRunning] = useState(false);
  const [probeMessage, setProbeMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  const runChecks = useCallback(async () => {
    setRunning(true);
    setProbeMessage(null);
    const transport = pitch.transport;
    const common = [
      pitchEndpoints.health(pitch.adminApiKey, undefined, transport),
      pitchEndpoints.me(pitch.adminApiKey, undefined, transport),
      pitchEndpoints.summary(pitch.adminApiKey, undefined, transport),
      pitchEndpoints.requests(
        pitch.adminApiKey,
        { page: 1, page_size: 1, time_range: '24h' },
        undefined,
        transport,
      ),
      pitchEndpoints.budgets(pitch.adminApiKey, undefined, transport),
      pitchEndpoints.savings(pitch.adminApiKey, undefined, transport),
      pitchEndpoints.alerts(pitch.adminApiKey, undefined, transport),
    ] as const;
    const results = await Promise.allSettled(common);
    const next: PreflightCheck[] = [];
    const labels = [
      'Backend health',
      'Administrative /dashboard/me',
      'Summary access',
      'Audit requests access',
      'Budgets access',
      'Savings access',
      'Alerts access',
    ];
    results.forEach((result, index) => {
      next.push({
        id: `endpoint-${index}`,
        label: labels[index],
        tone: result.status === 'fulfilled' ? 'green' : 'red',
        detail:
          result.status === 'fulfilled'
            ? 'Available'
            : readableApiError(result.reason),
      });
    });

    const health = results[0].status === 'fulfilled' ? results[0].value : null;
    const me = results[1].status === 'fulfilled' ? results[1].value : null;
    next.push({
      id: 'admin-role',
      label: 'Admin session',
      tone: me?.role === 'admin' ? 'green' : 'red',
      detail: me?.role === 'admin' ? `${me.consumer} · admin` : 'An admin key is required.',
    });
    next.push({
      id: 'consumer-key',
      label: 'Consumer key',
      tone: pitch.consumerKeyState.status === 'ready' ? 'green' : 'red',
      detail:
        pitch.consumerKeyState.status === 'ready'
          ? `${pitch.consumerKeyState.me?.consumer} · held in memory only`
          : pitch.consumerKeyState.message ?? 'Not configured',
    });

    if (pitch.demoConsumerApiKey && pitch.consumerKeyState.status === 'ready') {
      try {
        const models = await pitchEndpoints.models(
          pitch.demoConsumerApiKey,
          undefined,
          transport,
        );
        next.push({
          id: 'models',
          label: 'Consumer /v1/models',
          tone: models.data.some((model) => model.id === 'auto') ? 'green' : 'yellow',
          detail: `${models.data.length} model ${models.data.length === 1 ? 'entry' : 'entries'} visible`,
        });
      } catch (error) {
        next.push({
          id: 'models',
          label: 'Consumer /v1/models',
          tone: 'red',
          detail: readableApiError(error),
        });
      }
    } else {
      next.push({
        id: 'models',
        label: 'Consumer /v1/models',
        tone: 'red',
        detail: 'Waiting for a valid consumer key.',
      });
    }

    const frontendMocks = isMockMode();
    next.push({
      id: 'frontend-mocks',
      label: 'Frontend mock build',
      tone: pitch.mode === 'rehearsal' || !frontendMocks ? 'green' : 'yellow',
      detail: frontendMocks ? 'VITE_USE_MOCKS=true' : 'VITE_USE_MOCKS=false',
    });
    const providerDetail =
      health?.mock_providers === undefined
        ? 'Backend does not expose provider mode (older version).'
        : health.mock_providers
          ? 'MOCK_PROVIDERS=true · upstream-independent'
          : 'MOCK_PROVIDERS=false · providers are live';
    const providerTone: CheckTone =
      pitch.mode === 'rehearsal'
        ? 'green'
        : health?.mock_providers === undefined
          ? 'yellow'
          : pitch.mode === 'safe-backend'
            ? health.mock_providers
              ? 'green'
              : 'yellow'
            : health.mock_providers
              ? 'yellow'
              : 'green';
    next.push({
      id: 'provider-mode',
      label: 'Provider mode',
      tone: providerTone,
      detail: pitch.mode === 'rehearsal' ? 'Frontend rehearsal isolates the backend.' : providerDetail,
    });
    setChecks(next);
    setRunning(false);
  }, [
    pitch.adminApiKey,
    pitch.consumerKeyState,
    pitch.demoConsumerApiKey,
    pitch.mode,
    pitch.transport,
  ]);

  useEffect(() => {
    if (open) {
      void runChecks();
      window.setTimeout(() => closeRef.current?.focus(), 0);
    }
  }, [open, runChecks]);

  const tone = useMemo(() => overallTone(checks), [checks]);

  async function testConsumerRequest() {
    if (!pitch.demoConsumerApiKey || pitch.consumerKeyState.status !== 'ready') {
      setProbeMessage('Add a valid consumer key first.');
      return;
    }
    setProbeMessage('Testing /v1/models…');
    try {
      const models = await pitchEndpoints.models(
        pitch.demoConsumerApiKey,
        undefined,
        pitch.transport,
      );
      setProbeMessage(
        `Non-destructive request passed · ${models.data.length} model ${models.data.length === 1 ? 'entry' : 'entries'}.`,
      );
    } catch (error) {
      setProbeMessage(`Request failed · ${readableApiError(error)}`);
    }
  }

  if (!open) return null;

  return (
    <div className="pitch-preflight-backdrop" role="presentation">
      <section
        ref={panelRef}
        className="pitch-preflight"
        role="dialog"
        aria-modal="true"
        aria-labelledby="preflight-title"
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [href], [tabindex]:not([tabindex="-1"])',
          );
          if (!focusable?.length) return;
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
      >
        <header className="pitch-preflight__header">
          <div>
            <span className="pitch-kicker">SHOW CONTROL</span>
            <h2 id="preflight-title">Preflight</h2>
          </div>
          <div className={`pitch-preflight-summary ${tone}`}>
            <CheckIcon tone={tone} />
            {running ? 'Checking…' : tone === 'green' ? 'Ready to present' : tone === 'yellow' ? 'Ready with warnings' : 'Action required'}
          </div>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close preflight">
            ×
          </button>
        </header>

        <div className="pitch-preflight__body">
          <div className="pitch-preflight-column">
            <h3>1 · Demo level</h3>
            <div className="pitch-mode-options">
              {MODES.map((mode) => (
                <label key={mode.value} className={pitch.mode === mode.value ? 'is-selected' : ''}>
                  <input
                    type="radio"
                    name="pitch-mode"
                    value={mode.value}
                    checked={pitch.mode === mode.value}
                    disabled={
                      !!pitch.pendingBudget && pitch.pendingBudget.mode !== mode.value
                    }
                    onChange={() => pitch.setMode(mode.value)}
                  />
                  <span>
                    <strong>
                      {mode.label} {mode.recommended ? <em>recommended</em> : null}
                    </strong>
                    <small>{mode.detail}</small>
                  </span>
                </label>
              ))}
            </div>

            <h3>2 · Consumer identity</h3>
            {pitch.demoConsumerApiKey ? (
              <div className="pitch-key-saved">
                <div>
                  <span>Saved in memory</span>
                  <strong>
                    {pitch.consumerKeyState.me?.api_key_prefix ?? '••••••••'} ·{' '}
                    {pitch.consumerKeyState.me?.consumer ?? pitch.consumerKeyState.status}
                  </strong>
                </div>
                <button type="button" onClick={pitch.clearDemoConsumerApiKey}>
                  Replace
                </button>
              </div>
            ) : (
              <form
                className="pitch-key-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!manualKey.trim()) return;
                  pitch.setDemoConsumerApiKey(manualKey);
                  setManualKey('');
                }}
              >
                <label className="pitch-field">
                  <span>Consumer API key</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={manualKey}
                    onChange={(event) => setManualKey(event.target.value)}
                    placeholder="finops_key_…"
                  />
                </label>
                <button className="pitch-primary" type="submit" disabled={!manualKey.trim()}>
                  Keep in memory
                </button>
              </form>
            )}
            {DEMO_KEYS_ENABLED ? (
              <div className="pitch-demo-key-presets">
                <span>Development presets</span>
                {KNOWN_DEMO_CONSUMERS.map((entry) => (
                  <button
                    type="button"
                    key={entry.consumer}
                    onClick={() => pitch.setDemoConsumerApiKey(entry.key)}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            ) : null}
            <p className="pitch-security-note">
              Admin session: {pitch.adminMe.api_key_prefix}. Consumer keys never enter localStorage and never replace this session.
            </p>

            <div className="pitch-preflight-actions">
              <button type="button" onClick={() => void testConsumerRequest()}>
                Test non-destructive request
              </button>
              <button type="button" onClick={() => void runChecks()} disabled={running}>
                {running ? 'Checking…' : 'Run checks again'}
              </button>
            </div>
            {probeMessage ? <p className="pitch-probe-message" aria-live="polite">{probeMessage}</p> : null}
          </div>

          <div className="pitch-preflight-column">
            <h3>3 · Readiness</h3>
            <ul className="pitch-check-list" aria-live="polite">
              {checks.map((check) => (
                <li key={check.id}>
                  <CheckIcon tone={check.tone} />
                  <div>
                    <strong>{check.label}</strong>
                    <span>{check.detail}</span>
                  </div>
                </li>
              ))}
            </ul>

            <div className="pitch-preflight-safety">
              <strong>State safety</strong>
              {pitch.pendingBudget ? (
                <p>
                  Pending restore for {pitch.pendingBudget.consumer}: original limit{' '}
                  {pitch.pendingBudget.original.budget} {pitch.pendingBudget.original.currency}.
                </p>
              ) : (
                <p>No pending budget changes.</p>
              )}
              <button
                className={pitch.pendingBudget ? 'is-restore-pending' : ''}
                type="button"
                onClick={() => void pitch.restorePendingBudget()}
              >
                Restore pending budget
              </button>
              {pitch.restorationMessage ? (
                <span aria-live="polite">{pitch.restorationMessage}</span>
              ) : null}
            </div>
          </div>
        </div>

        <footer className="pitch-preflight__footer">
          <button type="button" onClick={onResetDeck}>
            Reset to slide 1
          </button>
          <span>Esc closes this panel · N toggles presenter notes</span>
          <button className="pitch-primary" type="button" onClick={onClose}>
            Start presentation
          </button>
        </footer>
      </section>
    </div>
  );
}
