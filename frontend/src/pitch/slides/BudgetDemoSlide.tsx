import { BudgetPressureDemo } from '../components/BudgetPressureDemo';
import { usePitch } from '../PitchContext';

export function BudgetDemoSlide() {
  const { mode } = usePitch();
  return (
    <div className="pitch-interactive-slide">
      <header className="pitch-slide-heading">
        <div>
          <div className="pitch-kicker">LIVE DEMO · POLICY</div>
          <h1>Budget is a <span>runtime decision.</span></h1>
        </div>
        <p>
          <span className={mode === 'rehearsal' ? 'pitch-data demo' : 'pitch-data live'}>
            {mode === 'rehearsal' ? 'DEMO DATA' : 'LIVE DATA'}
          </span>
          Change a real consumer limit, send a real request, then restore the exact captured configuration.
        </p>
      </header>
      <BudgetPressureDemo />
    </div>
  );
}
