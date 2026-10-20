import { cn } from '@/lib/utils';
import { Skeleton } from './ui/skeleton';

interface LoadingSkeletonProps {
  className?: string;
  label: string;
  // 'inline' is a single shimmering bar for status chips; 'block' mimics a short list.
  variant?: 'inline' | 'block';
  rows?: number;
}

export function LoadingSkeleton({ className, label, rows = 3, variant = 'block' }: LoadingSkeletonProps) {
  if (variant === 'inline') {
    return (
      <span aria-busy="true" aria-live="polite" className={cn('inline-flex items-center', className)} role="status">
        <span className="sr-only">{label}</span>
        <Skeleton className="h-4 w-20" />
      </span>
    );
  }

  return (
    <div aria-busy="true" aria-live="polite" className={cn('grid gap-2', className)} role="status">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, index) => (
        <div className="grid gap-2 rounded-lg border bg-background/60 p-3" key={index}>
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
        </div>
      ))}
    </div>
  );
}
