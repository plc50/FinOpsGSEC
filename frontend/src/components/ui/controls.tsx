import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
} from 'react';
import { cn } from '@/lib/cn';

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'default' | 'primary' | 'ghost' | 'danger';
    size?: 'sm' | 'md';
  }
>(function Button(
  { className, variant = 'default', size = 'md', ...props },
  ref,
) {
  const base =
    'inline-flex items-center justify-center gap-1.5 rounded-sm border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';
  const sizes = {
    sm: 'px-2.5 py-1 text-xs',
    md: 'px-3 py-1.5 text-sm',
  };
  const variants = {
    default:
      'border-line bg-surface text-text shadow-card hover:border-line-strong hover:bg-surface-raised',
    primary:
      'border-accent bg-accent text-white shadow-card hover:border-accent-strong hover:bg-accent-strong',
    ghost:
      'border-transparent bg-transparent text-text-secondary hover:bg-surface-raised hover:text-text',
    danger:
      'border-signal-red/30 bg-signal-red-dim text-signal-red hover:bg-signal-red/15',
  };
  return (
    <button
      ref={ref}
      className={cn(base, sizes[size], variants[variant], className)}
      {...props}
    />
  );
});

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(function Input({ className, ...props }, ref) {
  return (
    <input
      ref={ref}
      className={cn(
        'w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-sm text-text shadow-card transition-colors placeholder:text-text-muted focus:border-accent',
        className,
      )}
      {...props}
    />
  );
});

export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(function Select({ className, children, ...props }, ref) {
  return (
    <select
      ref={ref}
      className={cn(
        'w-full rounded-sm border border-line bg-surface px-2.5 py-1.5 text-sm text-text shadow-card transition-colors focus:border-accent',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
});

export function Field({
  label,
  htmlFor,
  children,
  hint,
  error,
}: {
  label: string;
  htmlFor?: string;
  children: ReactNode;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="space-y-1">
      <label
        htmlFor={htmlFor}
        className="block text-[11px] uppercase tracking-wide text-text-secondary"
      >
        {label}
      </label>
      {children}
      {error ? (
        <p className="text-[11px] text-signal-red">{error}</p>
      ) : hint ? (
        <p className="text-[11px] text-text-muted">{hint}</p>
      ) : null}
    </div>
  );
}
