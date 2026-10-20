import type { ComponentProps } from 'react';

import { cn } from '@/lib/utils';

function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-pulse rounded-md bg-muted/70', className)}
      data-slot="skeleton"
      {...props}
    />
  );
}

export { Skeleton };
