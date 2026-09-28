import { useEffect, useState } from 'react';
import { Modal } from '@/components/ui/Modal';
import { Button, Field, Input } from '@/components/ui/controls';
import { ErrorState } from '@/components/ui/states';
import { useUpdateBudget } from '@/api/queries';

/**
 * Admin budget editor (§7.7). Client validates budget > 0 and
 * 0.1 <= warning_threshold <= 0.99 before POST; backend validation errors
 * (validation_error) are still surfaced with their code.
 */
export function BudgetEditModal({
  open,
  onClose,
  consumer,
  initialBudget,
  initialWarningThreshold,
}: {
  open: boolean;
  onClose: () => void;
  consumer: string;
  initialBudget: number;
  initialWarningThreshold: number;
}) {
  const [budget, setBudget] = useState(String(initialBudget));
  const [warning, setWarning] = useState(String(initialWarningThreshold));
  const [localError, setLocalError] = useState<string | null>(null);
  const mutation = useUpdateBudget();

  useEffect(() => {
    if (open) {
      setBudget(String(initialBudget));
      setWarning(String(initialWarningThreshold));
      setLocalError(null);
      mutation.reset();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialBudget, initialWarningThreshold]);

  function validate(): { budget: number; warning_threshold: number } | null {
    const b = Number(budget);
    const w = Number(warning);
    if (!(b > 0)) {
      setLocalError('Budget must be greater than 0.');
      return null;
    }
    if (!(w >= 0.1 && w <= 0.99)) {
      setLocalError('Warning threshold must be between 0.1 and 0.99.');
      return null;
    }
    setLocalError(null);
    return { budget: b, warning_threshold: w };
  }

  function submit() {
    const values = validate();
    if (!values) return;
    mutation.mutate(
      { consumer, body: values },
      { onSuccess: () => onClose() },
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={`Edit budget — ${consumer}`}>
      <div className="space-y-3">
        {localError ? (
          <p className="text-xs text-signal-red">{localError}</p>
        ) : null}
        {mutation.isError ? (
          <ErrorState title="Update failed" error={mutation.error} />
        ) : null}
        <Field
          label="Budget (USD)"
          htmlFor="budget"
          hint="Must be greater than 0."
        >
          <Input
            id="budget"
            type="number"
            step="0.01"
            min="0"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </Field>
        <Field
          label="Warning threshold"
          htmlFor="warning"
          hint="Between 0.1 and 0.99 (e.g. 0.8 = alert at 80%)."
        >
          <Input
            id="warning"
            type="number"
            step="0.01"
            min="0.1"
            max="0.99"
            value={warning}
            onChange={(e) => setWarning(e.target.value)}
          />
        </Field>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={submit}
            disabled={mutation.isPending}
          >
            {mutation.isPending ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
