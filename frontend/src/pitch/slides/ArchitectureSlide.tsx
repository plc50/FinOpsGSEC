const PROXY_STEPS = [
  'Classification',
  'Routing policy',
  'Budget policy',
  'Semantic cache',
  'Audit + cost',
] as const;

export function ArchitectureSlide() {
  return (
    <div className="pitch-architecture">
      <div className="pitch-kicker">ONE COMPATIBLE ENDPOINT · FIVE CONTROL LOOPS</div>
      <div className="pitch-title-row">
        <h1>Control in the path<br /><span>of every request.</span></h1>
        <p>Architecture shown here is a capability map, not a live measurement.</p>
      </div>
      <div className="pitch-architecture-flow">
        <div className="pitch-architecture-client">
          <small>CONSUMERS</small>
          <strong>Client</strong>
          <code>OpenAI-compatible API</code>
        </div>
        <div className="pitch-architecture-arrow"><span>POST /v1/chat/completions</span>→</div>
        <div className="pitch-architecture-proxy">
          <header>
            <span>FINOPSGSEC</span>
            <strong>Proxy control plane</strong>
          </header>
          <ol>
            {PROXY_STEPS.map((step, index) => (
              <li key={step}>
                <span>{index + 1}</span>
                {step}
              </li>
            ))}
          </ol>
        </div>
        <div className="pitch-architecture-arrow">→</div>
        <div className="pitch-provider-stack">
          <small>PROVIDERS</small>
          <strong>OpenRouter</strong>
          <strong>Fireworks</strong>
          <strong>TabbyAPI</strong>
        </div>
      </div>
      <div className="pitch-architecture-proof">
        <span>Provider keys stay server-side</span>
        <span>Every outcome becomes an audit record</span>
        <span>Hosted and local models share one policy layer</span>
      </div>
    </div>
  );
}
