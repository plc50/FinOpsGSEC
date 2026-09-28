const PROBLEMS = [
  ['Invisible spend', 'Teams consume AI APIs before cost and ownership are visible.'],
  ['Hard-coded choice', 'The application—not policy—often decides the model.'],
  ['Late controls', 'Budgets are discovered after the invoice, not before the request.'],
  ['Paid twice', 'Equivalent prompts repeatedly travel to a provider.'],
  ['Split decisions', 'Cost, quality and latency live in disconnected systems.'],
] as const;

export function ProblemSlide() {
  return (
    <div className="pitch-problem">
      <div className="pitch-kicker">THE OPERATING GAP</div>
      <div className="pitch-title-row">
        <h1>AI became infrastructure.<br /><span>Its economics did not.</span></h1>
        <p>Without a control point, every team optimizes locally—and finance learns globally, too late.</p>
      </div>
      <div className="pitch-problem-grid">
        {PROBLEMS.map(([title, detail], index) => (
          <article key={title}>
            <span>0{index + 1}</span>
            <div>
              <h2>{title}</h2>
              <p>{detail}</p>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
