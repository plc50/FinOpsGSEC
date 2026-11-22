export function OpeningSlide() {
  return (
    <div className="pitch-opening">
      <div className="pitch-kicker">AI FINOPS CONTROL PLANE</div>
      <h1>
        Every AI request is a <span>financial decision.</span>
      </h1>
      <p>
        FinOpsGSEC sits between applications and AI providers—making every route observable, enforceable and cost-aware.
      </p>
      <div className="pitch-opening-flow" aria-label="Application through FinOpsGSEC to best provider and model">
        <div>
          <small>01</small>
          <strong>Application</strong>
        </div>
        <i>→</i>
        <div className="is-core">
          <small>CONTROL PLANE</small>
          <strong>FinOpsGSEC</strong>
        </div>
        <i>→</i>
        <div>
          <small>OPTIMAL ROUTE</small>
          <strong>Best provider / model</strong>
        </div>
      </div>
      <div className="pitch-opening-pillars" aria-label="Core capabilities">
        <span><b>R</b> Route</span>
        <span><b>C</b> Control</span>
        <span><b>O</b> Optimize</span>
      </div>
    </div>
  );
}
