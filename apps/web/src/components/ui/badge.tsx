import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap', {
  variants: {
    variant: {
      default: 'border-transparent bg-surface-2 text-fg',
      brand: 'border-transparent bg-brand-100 text-brand-800 dark:bg-brand-900/60 dark:text-brand-200',
      success: 'border-transparent bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200',
      warning: 'border-transparent bg-amber-100 text-amber-800 dark:bg-amber-900/50 dark:text-amber-200',
      danger: 'border-transparent bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200',
      info: 'border-transparent bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200',
      outline: 'text-fg',
      muted: 'border-transparent bg-surface-2 text-muted',
    },
  },
  defaultVariants: { variant: 'default' },
});

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}
export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

const STATUS_VARIANT: Record<string, BadgeProps['variant']> = {
  invited: 'info',
  ready: 'info',
  in_progress: 'warning',
  submitted: 'brand',
  completed: 'success',
  expired: 'muted',
  cancelled: 'muted',
  draft: 'muted',
  open: 'success',
  closed: 'warning',
  archived: 'muted',
  pending: 'info',
  accepted: 'success',
  graded: 'success',
  queued: 'info',
  running: 'warning',
  error: 'danger',
  failed: 'danger',
  generating: 'warning',
  parsed: 'success',
  parsing: 'warning',
  strong_hire: 'success',
  hire: 'success',
  borderline: 'warning',
  no_hire: 'danger',
  insufficient_evidence: 'muted',
  advance: 'success',
  hold: 'warning',
  reject: 'danger',
  passed: 'success',
  wrong_answer: 'danger',
  time_limit: 'warning',
  memory_limit: 'warning',
  runtime_error: 'danger',
  compile_error: 'danger',
  internal_error: 'muted',
};

export function StatusBadge({ status, label, className }: { status: string; label?: string; className?: string }) {
  return (
    <Badge variant={STATUS_VARIANT[status] ?? 'default'} className={className}>
      {label ?? status.replace(/_/g, ' ')}
    </Badge>
  );
}
