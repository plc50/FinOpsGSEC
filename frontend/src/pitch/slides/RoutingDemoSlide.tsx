import { LiveProxyDemo } from '../components/LiveProxyDemo';
import { usePitch } from '../PitchContext';

export function RoutingDemoSlide() {
  const { mode } = usePitch();
  return (
    <div className="pitch-interactive-slide">
      <header className="pitch-slide-heading">
        <div>
          <div className="pitch-kicker">LIVE DEMO · ROUTING</div>
          <h1>One request. <span>A defensible route.</span></h1>
        </div>
        <p>
          <span className={mode === 'rehearsal' ? 'pitch-data demo' : 'pitch-data live'}>
            {mode === 'rehearsal' ? 'DEMO DATA' : 'LIVE DATA'}
          </span>
          The response is immediate; cost and policy evidence come only from the new audit record.
        </p>
      </header>
      <LiveProxyDemo />
    </div>
  );
}
