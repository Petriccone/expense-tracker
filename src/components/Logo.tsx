'use client';

import { useId } from 'react';

type LogoProps = {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
};

/**
 * ExpensesAI mark: three ascending bars (growth / spend tracking) in the
 * app's purple -> cyan accent gradient, on a rounded dark tile so it stays
 * legible on the dark sidebar and works as a standalone favicon.
 */
export default function Logo({ size = 32, className, style }: LogoProps) {
  const uid = useId();
  const bgId = `logo-bg-${uid}`;
  const markId = `logo-mark-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={style}
      role="img"
      aria-label="ExpensesAI"
    >
      <defs>
        <linearGradient id={bgId} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#131A2E" />
          <stop offset="100%" stopColor="#0A0F1E" />
        </linearGradient>
        <linearGradient id={markId} gradientUnits="userSpaceOnUse" x1="8" y1="23" x2="24" y2="9">
          <stop offset="0%" stopColor="#7C3AED" />
          <stop offset="100%" stopColor="#06B6D4" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="9" fill={`url(#${bgId})`} />
      <rect x="0.5" y="0.5" width="31" height="31" rx="8.5" fill="none" stroke={`url(#${markId})`} strokeOpacity="0.35" />
      <rect x="8" y="17" width="4" height="6" rx="2" fill={`url(#${markId})`} />
      <rect x="14" y="13" width="4" height="10" rx="2" fill={`url(#${markId})`} />
      <rect x="20" y="9" width="4" height="14" rx="2" fill={`url(#${markId})`} />
    </svg>
  );
}
