import { SemanticCacheDemo } from '../components/SemanticCacheDemo';
import { usePitch } from '../PitchContext';

export function CacheDemoSlide() {
  const { mode } = usePitch();
  return (
    <div className="pitch-interactive-slide">
      <header className="pitch-slide-heading">
        <div>
          <div className="pitch-kicker">LIVE DEMO · SEMANTIC CACHE</div>
          <h1>Equivalent intent. <span>No second bill.</span></h1>
        </div>
        <p>
          <span className={mode === 'rehearsal' ? 'pitch-data demo' : 'pitch-data live'}>
            {mode === 'rehearsal' ? 'DEMO DATA' : 'LIVE DATA'}
          </span>
          A hit appears only when the audit confirms <code>semantic_cache</code>.
        </p>
      </header>
      <SemanticCacheDemo />
    </div>
  );
}
