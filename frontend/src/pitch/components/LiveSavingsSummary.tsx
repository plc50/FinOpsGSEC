import { useQuery } from '@tanstack/react-query';
import { pitchEndpoints } from '@/api/endpoints';
import { formatCurrency, formatInt, formatPercent } from '@/lib/format';
import { usePitch } from '../PitchContext';
import { readableApiError } from '../pitchApi';

export function LiveSavingsSummary() {
  const pitch = usePitch();
  const query = useQuery({
    queryKey: ['pitch', 'savings', pitch.mode],
    queryFn: ({ signal }) =>
      pitchEndpoints.savings(pitch.adminApiKey, signal, pitch.transport),
    staleTime: 15_000,
  });
  const data = query.data;
  const routing = data?.mechanisms.find(
    (mechanism) => mechanism.mechanism === 'smart_routing',
  );
  const cache = data?.mechanisms.find(
    (mechanism) => mechanism.mechanism === 'semantic_cache',
  );

  if (query.isPending) {
    return (
      <div className="pitch-savings-loading" aria-live="polite">
        <span />
        Loading audited savings…
      </div>
    );
  }

  if (query.isError || !data) {
    return (
      <div className="pitch-savings-error" role="alert">
        <strong>Savings are temporarily unavailable.</strong>
        <p>{readableApiError(query.error)}</p>
        <div className="pitch-demo-actions">
          <button type="button" onClick={() => void query.refetch()}>
            Retry
          </button>
          <button type="button" onClick={() => pitch.setMode('rehearsal')}>
            Use rehearsal data
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pitch-savings-summary">
      <div className="pitch-savings-head">
        <span className={pitch.mode === 'rehearsal' ? 'pitch-data demo' : 'pitch-data live'}>
          {pitch.mode === 'rehearsal' ? 'DEMO DATA' : 'LIVE DATA'}
        </span>
        <span>
          {new Date(data.start).toLocaleDateString()} —{' '}
          {new Date(data.end).toLocaleDateString()}
        </span>
        <button type="button" onClick={() => void query.refetch()} disabled={query.isFetching}>
          {query.isFetching ? 'Refreshing…' : '↻ Refresh'}
        </button>
      </div>

      <div className="pitch-savings-hero">
        <div>
          <span>Total saved</span>
          <strong>{formatCurrency(data.total_savings, data.currency)}</strong>
          <small>{formatPercent(data.savings_ratio)} below baseline</small>
        </div>
        <div className="pitch-cost-equation" aria-label="Actual cost compared with baseline">
          <div>
            <span>Actual</span>
            <strong>{formatCurrency(data.actual_spend, data.currency)}</strong>
          </div>
          <i>vs</i>
          <div>
            <span>Baseline</span>
            <strong>{formatCurrency(data.baseline_spend, data.currency)}</strong>
          </div>
        </div>
      </div>

      <div className="pitch-savings-breakdown">
        <div>
          <header>
            <span>Smart routing</span>
            <strong>{formatCurrency(routing?.savings, data.currency)}</strong>
          </header>
          <div className="pitch-saving-track">
            <span style={{ width: `${Math.max(2, (routing?.share ?? 0) * 100)}%` }} />
          </div>
          <small>{routing?.kind ?? '—'} · {routing?.requests ?? 0} requests</small>
        </div>
        <div>
          <header>
            <span>Semantic cache</span>
            <strong>{formatCurrency(cache?.savings, data.currency)}</strong>
          </header>
          <div className="pitch-saving-track cache">
            <span style={{ width: `${Math.max(2, (cache?.share ?? 0) * 100)}%` }} />
          </div>
          <small>{cache?.kind ?? '—'} · {cache?.extra.hits ?? cache?.requests ?? 0} hits</small>
        </div>
      </div>

      <p className="pitch-savings-footnote">
        {formatInt(data.requests_analyzed)} audited requests · measured and estimated mechanisms remain labelled by the backend.
      </p>
    </div>
  );
}
