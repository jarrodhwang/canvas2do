import type { CSSProperties } from 'react';
import { useState } from 'react';

import { cn } from '../lib/utils';

export type GoogleProduct = 'gmail' | 'chat' | 'meet' | 'docs' | 'sheets' | 'slides' | 'drive' | 'gemini' | 'figma';

const googleProductIcons: Record<
  GoogleProduct,
  { src: string; label: string; fallback: string; color: string }
> = {
  chat: {
    color: '#34A853',
    fallback: 'C',
    label: 'Google Chat',
    src: 'https://www.gstatic.com/images/branding/product/1x/chat_2020q4_48dp.png',
  },
  docs: {
    color: '#4285F4',
    fallback: 'D',
    label: 'Google Docs',
    src: 'https://www.gstatic.com/images/branding/product/1x/docs_2020q4_48dp.png',
  },
  drive: {
    color: '#188038',
    fallback: 'D',
    label: 'Google Drive',
    src: 'https://ssl.gstatic.com/docs/doclist/images/drive_2022q3_32dp.png',
  },
  figma: {
    color: '#1E1E1E',
    fallback: 'F',
    label: 'Figma',
    src: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/svg/figma.svg',
  },
  gmail: {
    color: '#EA4335',
    fallback: 'G',
    label: 'Gmail',
    src: 'https://www.gstatic.com/images/branding/product/1x/gmail_2020q4_48dp.png',
  },
  gemini: {
    color: '#4285F4',
    fallback: '✦',
    label: 'Gemini',
    src: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/google-gemini.png',
  },
  meet: {
    color: '#0086F8',
    fallback: 'M',
    label: 'Google Meet',
    src: 'https://www.gstatic.com/images/branding/product/1x/meet_2020q4_48dp.png',
  },
  sheets: {
    color: '#0F9D58',
    fallback: 'S',
    label: 'Google Sheets',
    src: 'https://www.gstatic.com/images/branding/product/1x/sheets_2020q4_48dp.png',
  },
  slides: {
    color: '#F4B400',
    fallback: 'S',
    label: 'Google Slides',
    src: 'https://www.gstatic.com/images/branding/product/1x/slides_2020q4_48dp.png',
  },
};

interface GoogleProductIconProps {
  product: GoogleProduct;
  size?: number;
  className?: string;
  decorative?: boolean;
}

export function GoogleProductIcon({
  product,
  size = 16,
  className,
  decorative = true,
}: GoogleProductIconProps) {
  const [failed, setFailed] = useState(false);
  const icon = googleProductIcons[product];
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
