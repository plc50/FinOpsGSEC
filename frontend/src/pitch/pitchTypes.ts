import type {
  ApiErrorBody,
  AuditRow,
  Budget,
  ChatCompletionResponse,
  Me,
} from '@/api/types';
import type { ApiError } from '@/api/client';

export type DemoMode = 'live' | 'safe-backend' | 'rehearsal';

export type DemoPhase =
  | 'ready'
  | 'sending'
  | 'waiting_for_audit'
  | 'completed'
  | 'failed'
  | 'rehearsal';

export interface CorrelatedDemoResult {
  completion: ChatCompletionResponse | null;
  audit: AuditRow | null;
  chatError: ApiError | Error | null;
  auditTimedOut: boolean;
}

export interface PendingBudgetChange {
  consumer: string;
  original: Budget;
  mode: DemoMode;
  changedAt: string;
}

export interface PresenterNotes {
  message: string;
  action: string;
  duration: string;
  fallback: string;
}

export interface PitchSlideDefinition {
  id: string;
  title: string;
  notes: PresenterNotes;
}

export type CheckTone = 'green' | 'yellow' | 'red';

export interface PreflightCheck {
  id: string;
  label: string;
  tone: CheckTone;
  detail: string;
}

export interface ConsumerKeyState {
  status: 'missing' | 'checking' | 'ready' | 'error';
  me: Me | null;
  message: string | null;
}

// Re-exported solely to keep generated declaration output explicit when the
// backend returns an OpenAI-style error during a budget-block demo.
export type PitchApiErrorBody = ApiErrorBody;
