const CAPABILITIES = [
  'OpenAI-compatible',
  'Multi-provider',
  'Budget-aware',
  'Auditable',
  'Cache-enabled',
  'Local or hosted models',
] as const;

export function ClosingSlide() {
  return (
    <div className="pitch-closing">
      <div className="pitch-kicker">FINOPSGSEC</div>
      <h1>
        FinOpsGSEC turns AI infrastructure into an <span>observable</span>,{' '}
        <span>enforceable</span> and <span>optimizable</span> system.
      </h1>
      <div className="pitch-closing-capabilities">
        {CAPABILITIES.map((capability) => <span key={capability}>{capability}</span>)}
      </div>
      <a href="https://github.com/juandiego-bmu/FinOpsGSEC">
        github.com/juandiego-bmu/FinOpsGSEC <b>↗</b>
      </a>
    </div>
  );
}
