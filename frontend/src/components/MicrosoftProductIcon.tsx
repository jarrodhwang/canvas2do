import type { CSSProperties } from 'react';
import { useState } from 'react';

import { cn } from '../lib/utils';

export type MicrosoftProduct = 'outlook';

const microsoftProductIcons: Record<
  MicrosoftProduct,
  { src: string; label: string; fallback: string; color: string }
> = {
  outlook: {
    color: '#0078D4',
    fallback: 'O',
    label: 'Microsoft Outlook',
    src: 'https://upload.wikimedia.org/wikipedia/commons/c/cc/Microsoft_Outlook_Icon_%282025%E2%80%93present%29.svg',
  },
};

interface MicrosoftProductIconProps {
  product: MicrosoftProduct;
  size?: number;
  className?: string;
  decorative?: boolean;
}

export function MicrosoftProductIcon({
  product,
  size = 16,
  className,
  decorative = true,
}: MicrosoftProductIconProps) {
  const [failed, setFailed] = useState(false);
  const icon = microsoftProductIcons[product];
  const iconStyle = { height: size, width: size } satisfies CSSProperties;

  if (!failed) {
    return (
      <img
        alt={decorative ? '' : icon.label}
        aria-hidden={decorative ? true : undefined}
        className={cn('inline-block shrink-0 object-contain', className)}
        draggable={false}
        onError={() => setFailed(true)}
        src={icon.src}
        style={iconStyle}
      />
    );
  }

  return (
    <span
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : icon.label}
      className={cn(
        'inline-grid shrink-0 place-items-center rounded-[4px] text-[9px] font-black leading-none text-white',
        className,
      )}
      role={decorative ? undefined : 'img'}
      style={{ ...iconStyle, backgroundColor: icon.color }}
    >
      {icon.fallback}
    </span>
  );
}
