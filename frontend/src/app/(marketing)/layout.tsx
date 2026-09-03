import type { Metadata } from 'next';
import { IBM_Plex_Mono, Instrument_Sans } from 'next/font/google';

import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';

/**
 * Two typefaces, loaded here rather than globally.
 *
 * The application does not use either of them, and shipping a marketing site's
 * fonts to every dashboard render would cost the people who are in the product
 * all day to serve the people who are on the site for thirty seconds.
 *
 * `next/font` self-hosts and inlines the `@font-face` rules, so there is no
 * request to Google on page load and no flash of fallback text — which on a
 * page whose headline is 64px is the difference between a considered document
 * and a broken one.
 */
const sans = Instrument_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-marketing-sans',
  display: 'swap',
});

const mono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-marketing-mono',
  display: 'swap',
});

/**
 * The public site's metadata, which overrides the root layout's in two ways.
 *
 * `absolute` rather than `default`: the root layout carries a `%s · Financy`
 * template and a `default` inherits it, so the home page's title came out as
 * "Financy — company spend, under control by default · Financy". `absolute`
 * opts this one string out while leaving the template in place for the pages
 * below, which do want it.
 *
 * `robots` is inverted because the root layout sets noindex — right for a
 * dashboard behind a session, wrong for the pages whose whole job is to be
 * found.
 */
export const metadata: Metadata = {
  title: {
    absolute: 'Financy — company spend, under control by default',
    template: '%s · Financy',
  },
  robots: { index: true, follow: true },
  description:
    'Cards, expenses, approvals and budgets on a single ledger. Policy is enforced when the card is used, not discovered at month end.',
};

/**
 * The public site.
 *
 * A separate route group from `(app)` and `(auth)` because it answers to
 * nothing the other two do: no session, no shell, no permission filtering, and
 * a deliberately different visual register. The application is a cool near-white
 * because people work in it all day; this is warm paper because someone gives it
 * thirty seconds and should feel they are reading a document.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div
      className={`${sans.variable} ${mono.variable} min-h-screen bg-[#F6F5F2] text-[#14161A] antialiased`}
      style={{ fontFamily: 'var(--font-marketing-sans), system-ui, sans-serif' }}
    >
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}
