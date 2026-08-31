import type { IconName } from '@/lib/navigation';

/**
 * Icon set — line icons, 1.5px stroke, 24px grid, currentColor.
 *
 * One consistent set across the product. Icons are never the sole carrier of
 * meaning: every navigation icon is paired with its label, and every icon-only
 * control carries an `aria-label`.
 */

const PATHS: Record<IconName, string> = {
  dashboard: 'M4 4h7v7H4V4Zm9 0h7v4h-7V4ZM4 13h7v7H4v-7Zm9-3h7v10h-7V10Z',
  send: 'M4 12h9m0 0-3-3m3 3-3 3M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4',
  card: 'M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8Zm0 3h18M6 15h3',
  list: 'M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01',
  receipt: 'M6 3h12v18l-3-2-3 2-3-2-3 2V3Zm3 5h6m-6 4h6',
  gauge: 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm1.5-3.5L17 7M4 18a9 9 0 1 1 16 0',
  invoice: 'M5 3h14v18l-2.5-1.5L14 21l-2-1.5L10 21l-2.5-1.5L5 21V3Zm3 5h8m-8 4h8m-8 4h4',
  cart: 'M3 4h2l2.5 11h10L20 7H6M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm8 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z',
  building:
    'M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M14 9h4a2 2 0 0 1 2 2v10M3 21h18M8 7h2M8 11h2M8 15h2',
  chart: 'M4 20V10m5 10V4m5 16v-7m5 7V8',
  ledger: 'M4 5a2 2 0 0 1 2-2h13v18H6a2 2 0 0 1-2-2V5Zm4-2v18M12 8h4m-4 4h4',
  users:
    'M16 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 9v-1a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  shield: 'M12 3l8 3v6c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V6l8-3Zm-2.5 9 2 2 4-4',
  cog: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm8.4-3a8.4 8.4 0 0 0-.2-1.8l2-1.5-2-3.4-2.3 1a8.4 8.4 0 0 0-3-1.8L14.4 2H9.6l-.5 2.5a8.4 8.4 0 0 0-3 1.8l-2.3-1-2 3.4 2 1.5a8.4 8.4 0 0 0 0 3.6l-2 1.5 2 3.4 2.3-1a8.4 8.4 0 0 0 3 1.8l.5 2.5h4.8l.5-2.5a8.4 8.4 0 0 0 3-1.8l2.3 1 2-3.4-2-1.5c.13-.58.2-1.19.2-1.8Z',
  history: 'M3 12a9 9 0 1 0 2.6-6.4M3 4v5h5M12 7v5l3.5 2',
};

export function Icon({
  name,
  className = 'size-[18px]',
}: {
  name: IconName;
  className?: string;
}): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

/** The product mark. Original to Financy — an ascending bar motif inside a rounded square. */
export function Logo({ className = 'size-7' }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 28 28" fill="none" aria-hidden="true">
      <rect width="28" height="28" rx="7" fill="currentColor" />
      <path
        d="M8 19V13M13 19V9M18 19v-3.5M20.5 9.5 18 12l-2.5-2L13 12"
        stroke="white"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
