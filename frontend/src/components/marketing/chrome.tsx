import Link from 'next/link';

import { FOOTER_COLUMNS, NAV } from './content';
import { Container } from './primitives';
import { EYEBROW, LINE } from './theme';

/**
 * The mark: a filled cobalt square.
 *
 * No icon, no wordmark lockup. The square is the only decorative element on the
 * entire site, and it is decorative precisely because everything else is a
 * hairline — one solid shape reads as a logo where a second would read as
 * ornament.
 */
function Mark({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      className="block shrink-0 bg-[#2B39C4]"
      style={{ width: size, height: size }}
    />
  );
}

/**
 * The public header.
 *
 * Sticky, 64px, translucent over a blur — so the ruled sections below scroll
 * under it and stay legible rather than colliding with it. `Book a demo` is
 * near-black rather than cobalt: the cobalt button belongs to the hero, and two
 * saturated buttons in one viewport means neither is the primary action.
 */
export function MarketingNav(): React.JSX.Element {
  return (
    <header
      className="sticky top-0 z-[60] bg-[rgba(246,245,242,0.92)] backdrop-blur-[10px]"
      style={{ borderBottom: `1px solid ${LINE}` }}
    >
      <Container className="flex h-16 items-center gap-6 lg:gap-11">
        <Link
          href="/"
          className="flex items-center gap-[9px] text-[16px] font-semibold tracking-[-0.02em] text-[#14161A]"
        >
          <Mark />
          Financy
        </Link>

        <nav aria-label="Primary" className="hidden items-center gap-7 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[14px] font-medium text-[#565A63] transition-colors hover:text-[#14161A]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        {/*
         * Three destinations, in the order a visitor needs them: back in,
         * talk to someone, start on your own. "Sign in" rather than "Log in"
         * because that is the word the sign-in screen itself uses, and a
         * visitor should not have to notice they are the same door.
         */}
        <div className="ml-auto flex items-center gap-4 sm:gap-5">
          <Link
            href="/login"
            className="hidden text-[14px] font-medium text-[#565A63] transition-colors hover:text-[#14161A] sm:block"
          >
            Sign in
          </Link>
          <Link
            href="/contact"
            className="hidden text-[14px] font-medium text-[#565A63] transition-colors hover:text-[#14161A] sm:block"
          >
            Book a demo
          </Link>
          <Link
            href="/register"
            className="rounded-md bg-[#14161A] px-4 py-[9px] text-[14px] font-semibold text-[#F6F5F2] transition-colors hover:bg-[#2B39C4] hover:text-white"
          >
            Get started
          </Link>
        </div>
      </Container>
    </header>
  );
}

export function MarketingFooter(): React.JSX.Element {
  return (
    <footer className="bg-[#F6F5F2]" style={{ borderTop: `1px solid ${LINE}` }}>
      <Container className="grid gap-10 pt-14 pb-8 sm:grid-cols-2 lg:grid-cols-[1.5fr_repeat(4,1fr)]">
        <div>
          <div className="mb-3 flex items-center gap-[9px] text-[16px] font-semibold tracking-[-0.02em]">
            <Mark />
            Financy
          </div>
          <p className="m-0 max-w-[250px] text-[13.5px] leading-[1.55] text-[#7A7E88]">
            Cards, expenses and approvals on one ledger.
          </p>
        </div>

        {FOOTER_COLUMNS.map((column) => (
          <div key={column.head}>
            <div className={`${EYEBROW} mb-4`}>{column.head}</div>
            <div className="flex flex-col gap-[9px] text-[14px] text-[#4B4F58]">
              {column.items.map((item) => (
                <Link
                  key={`${column.head}-${item.label}`}
                  href={item.href}
                  className="transition-colors hover:text-[#2B39C4]"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </div>
        ))}
      </Container>

      <Container className="pb-9">
        {/*
         * The disclaimer sits on every marketing page, not only on the sign-in
         * screens. A page that talks about cards and spend reads like a bank
         * to someone skimming it, and the correction has to be where the claim
         * is. Wording matches `(auth)/layout.tsx`; change both together.
         */}
        <p
          className="m-0 pt-[22px] text-[13px] leading-[1.55] text-[#7A7E88]"
          style={{ borderTop: `1px solid ${LINE}` }}
        >
          Financy is not a bank and holds no compliance certification.
        </p>
        <div className="flex flex-wrap justify-between gap-5 pt-4 text-[13px] text-[#7A7E88]">
          <span>© {new Date().getFullYear()} Financy</span>
          <span className="flex gap-6">
            <Link href="/privacy" className="transition-colors hover:text-[#2B39C4]">
              Privacy
            </Link>
            <Link href="/terms" className="transition-colors hover:text-[#2B39C4]">
              Terms
            </Link>
            <Link href="/security" className="transition-colors hover:text-[#2B39C4]">
              Security
            </Link>
          </span>
        </div>
      </Container>
    </footer>
  );
}
