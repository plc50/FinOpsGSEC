import type { DemoPhase } from '../pitchTypes';

const LABELS: Record<DemoPhase, string> = {
  ready: 'Ready',
  sending: 'Sending',
  waiting_for_audit: 'Waiting for audit',
  completed: 'Completed',
  failed: 'Failed',
  rehearsal: 'Running in rehearsal mode',
};

export function DemoStatus({
  phase,
  message,
}: {
  phase: DemoPhase;
  message?: string | null;
}) {
  return (
    <div className="pitch-demo-status" aria-live="polite" data-phase={phase}>
      <span className="pitch-demo-status__dot" aria-hidden="true" />
      <span>{LABELS[phase]}</span>
      {message ? <span className="pitch-demo-status__message">· {message}</span> : null}
    </div>
  );
}
