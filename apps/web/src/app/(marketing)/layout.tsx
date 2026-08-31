import type { Metadata } from 'next';

import { MarketingFooter, MarketingNav } from '@/components/marketing/chrome';

export const metadata: Metadata = {
  title: 'Financy — control, evidence, and explanation for company spend',
  description:
    'Spend is authorised against written policy before money leaves the business, evidence is captured as it is spent, and reconciliation becomes a review of an already-complete record.',
};

/**
 * The public site.
 *
 * A separate route group from `(app)` and `(auth)` because it answers to
 * nothing the other two do: no session, no shell, no permission filtering, and
 * a completely different visual register. The application is dense and quiet
 * because people work in it all day; this is loud because someone gives it
 * thirty seconds.
 */
export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="min-h-screen bg-[#0b1120] text-white antialiased">
      <MarketingNav />
      {children}
      <MarketingFooter />
    </div>
  );
}
