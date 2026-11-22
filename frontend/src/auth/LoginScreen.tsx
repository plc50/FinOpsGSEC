import { useState } from 'react';
import { useAuth } from './AuthContext';
import { Button, Field, Input } from '@/components/ui/controls';
import { ErrorState } from '@/components/ui/states';
import { isMockMode } from '@/api/mocks';

const QUICK_KEYS: { label: string; consumer: string; key: string; role: string }[] = [
  { label: 'Marketing', consumer: 'equipo-marketing', key: 'finops_key_marketing', role: 'consumer' },
  { label: 'Producto', consumer: 'equipo-producto', key: 'finops_key_producto', role: 'consumer' },
  { label: 'Atención Cliente', consumer: 'equipo-atencion-cliente', key: 'finops_key_atencion', role: 'consumer' },
  { label: 'Admin', consumer: 'admin', key: 'finops_key_admin', role: 'admin' },
];

const SHOW_DEMO_KEYS =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_DEMO_KEYS === 'true';

export function LoginScreen() {
  const { signIn, signOut, status, error } = useAuth();
  const [manualKey, setManualKey] = useState('');

  const authFailed = status === 'error';

  return (
    <div className="flex min-h-full items-center justify-center bg-gradient-to-br from-bg via-accent-soft/60 to-bg p-4">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface shadow-pop">
        <div className="border-b border-line px-4 py-3.5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-sm bg-accent text-xs font-bold text-white">
              F
            </span>
            <h1 className="text-base font-semibold tracking-tight text-text">
              AI FinOps Console
            </h1>
          </div>
          <p className="mt-1.5 text-xs text-text-secondary">
            Cost-control proxy for internal AI consumers. Sign in with a FinOps
            API key.
          </p>
        </div>

        <div className="space-y-4 p-4">
          {authFailed ? (
            <ErrorState
              title="Sign-in failed"
              error={error}
              onRetry={signOut}
            />
          ) : null}

          {SHOW_DEMO_KEYS ? (
            <div>
              <p className="mb-2 text-[11px] uppercase tracking-wide text-text-secondary">
                Demo keys
              </p>
              <div className="grid grid-cols-2 gap-2">
                {QUICK_KEYS.map((q) => (
                  <button
                    key={q.key}
                    type="button"
                    onClick={() => signIn(q.key)}
                    disabled={status === 'loading'}
                    className="flex flex-col items-start gap-0.5 rounded-sm border border-line bg-surface px-2.5 py-2 text-left shadow-card transition-colors hover:border-accent hover:bg-accent-soft/40 disabled:opacity-50"
                  >
                    <span className="text-sm text-text">{q.label}</span>
                    <span className="text-[11px] text-text-muted">{q.consumer}</span>
                    <span
                      className={
                        q.role === 'admin'
                          ? 'text-[10px] uppercase tracking-wide text-signal-amber'
                          : 'text-[10px] uppercase tracking-wide text-text-secondary'
                      }
                    >
                      {q.role}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <form
            className="space-y-2 border-t border-line pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (manualKey.trim()) signIn(manualKey);
            }}
          >
            <Field label="Or enter an API key" htmlFor="apikey">
              <Input
                id="apikey"
                type="password"
                autoComplete="off"
                placeholder="finops_key_..."
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
              />
            </Field>
            <Button
              type="submit"
              variant="primary"
              className="w-full"
              disabled={!manualKey.trim() || status === 'loading'}
            >
              {status === 'loading' ? 'Verifying…' : 'Sign in'}
            </Button>
          </form>

          <p className="text-[11px] leading-relaxed text-text-muted">
            Keys are held in memory (sessionStorage for reload persistence),
            never in localStorage. Only the key prefix from{' '}
            <span className="text-text-secondary">/dashboard/me</span> is shown
            after sign-in.
            {isMockMode() ? (
              <>
                {' '}
                <span className="text-signal-amber">Mock mode is ON</span> — data
                is served from local fixtures.
              </>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}
