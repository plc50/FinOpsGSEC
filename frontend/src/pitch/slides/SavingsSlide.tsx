import { LiveSavingsSummary } from '../components/LiveSavingsSummary';

export function SavingsSlide() {
  return (
    <div className="pitch-savings-slide">
      <header className="pitch-slide-heading">
        <div>
          <div className="pitch-kicker">AUDITED IMPACT</div>
          <h1>Optimization you can <span>measure.</span></h1>
        </div>
        <p>Same savings contract as the console, recomposed for the decision—not embedded as a dashboard.</p>
      </header>
      <LiveSavingsSummary />
    </div>
  );
}
