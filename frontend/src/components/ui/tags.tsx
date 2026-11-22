import type {
  BudgetAction,
  ForecastStatus,
  RequestStatus,
  Severity,
} from '@/api/types';
import { humanizeEnum } from '@/lib/format';
import {
  budgetActionTone,
  forecastTone,
  severityTone,
  statusTone,
} from '@/lib/signals';
import { Badge } from './Badge';

export function ForecastStatusTag({ status }: { status: ForecastStatus }) {
  return <Badge tone={forecastTone(status)}>{humanizeEnum(status)}</Badge>;
}

export function SeverityTag({ severity }: { severity: Severity }) {
  return <Badge tone={severityTone(severity)}>{severity}</Badge>;
}

export function BudgetActionTag({ action }: { action: BudgetAction }) {
  return <Badge tone={budgetActionTone(action)}>{humanizeEnum(action)}</Badge>;
}

export function StatusTag({ status }: { status: RequestStatus }) {
  return <Badge tone={statusTone(status)}>{humanizeEnum(status)}</Badge>;
}
