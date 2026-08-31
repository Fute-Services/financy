import Link from 'next/link';

import { Logo } from '@/components/icons';

/**
 * Navigation and footer for the public site.
 *
 * Sharp corners, flat surfaces, no shadows. The visual register is deliberate:
 * a fintech buyer reads rounded and soft as consumer, and this product is sold
 * to a finance team that wants it to look like infrastructure.
 */

const PRODUCT_LINKS = [
  { label: 'Spend control', href: '/#control' },
  { label: 'The record', href: '/#record' },
  { label: 'How it works', href: '/#how' },
  { label: 'Engineering', href: '/#engineering' },
];

export function MarketingNav(): React.JSX.Element {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b1120]/85 backdrop-blur">
      <nav
        aria-label="Primary"
        className="mx-auto flex h-16 max-w-[1200px] items-center gap-8 px-6"
      >
        <Link href="/" className="flex shrink-0 items-center gap-2">
          {/* Cobalt, not white: the mark is a filled square with white strokes
              on top, so a white fill renders it as a blank square. */}
          <span className="text-cobalt-500">
            <Logo />
          </span>
          <span className="text-[15px] font-semibold tracking-tight">Financy</span>
        </Link>

        <ul className="hidden flex-1 items-center gap-7 md:flex">
          {PRODUCT_LINKS.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                className="text-[13.5px] text-white/65 transition-colors hover:text-white"
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2 md:ml-0">
          <Link
            href="/login"
            className="px-3 py-2 text-[13.5px] text-white/70 transition-colors hover:text-white"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="bg-white px-4 py-2.5 text-[13.5px] font-medium text-[#0b1120] transition-colors hover:bg-white/90"
          >
            Get started
          </Link>
        </div>
      </nav>
    </header>
  );
}

const FOOTER_COLUMNS: Array<{ heading: string; links: Array<{ label: string; href: string }> }> = [
  {
    heading: 'Product',
    links: [
      { label: 'Spend control', href: '/#control' },
      { label: 'The record', href: '/#record' },
      { label: 'How it works', href: '/#how' },
    ],
  },
  {
    heading: 'Engineering',
    links: [
      { label: 'Architecture', href: '/#engineering' },
      { label: 'Security model', href: '/#engineering' },
      { label: 'Roadmap', href: '/#roadmap' },
    ],
  },
  {
    heading: 'Account',
    links: [
      { label: 'Sign in', href: '/login' },
      { label: 'Create an organisation', href: '/register' },
    ],
  },
];

export function MarketingFooter(): React.JSX.Element {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto max-w-[1200px] px-6 py-14">
        <div className="grid gap-10 md:grid-cols-[2fr_1fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-cobalt-500">
                <Logo />
              </span>
              <span className="text-[15px] font-semibold tracking-tight">Financy</span>
            </div>
            <p className="mt-3 max-w-xs text-[13.5px] leading-relaxed text-white/55">
              The control and orchestration layer for company spending.
            </p>
          </div>

          {FOOTER_COLUMNS.map((column) => (
            <div key={column.heading}>
              <p className="text-[11px] font-semibold tracking-wider text-white/40 uppercase">
                {column.heading}
              </p>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-[13.5px] text-white/65 transition-colors hover:text-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/*
          The disclaimer is not boilerplate and is not buried. A spend product
          that let a reader assume it was a bank, or that it held a compliance
          certification, would be trading on an impression it has not earned.
        */}
        <div className="mt-14 border-t border-white/10 pt-8">
          <p className="max-w-3xl text-[12.5px] leading-relaxed text-white/40">
            Financy is not a bank, a card network, or a general ledger. It governs, records, and
            explains spend, and integrates with the institutions and accounting systems that move
            and book money. It holds no compliance certification — not SOC&nbsp;2, not PCI&nbsp;DSS,
            not ISO&nbsp;27001 — and is not a regulated financial institution.
          </p>
          <p className="mt-5 text-[12.5px] text-white/40">
            © {new Date().getFullYear()} Financy. Pre-release.
          </p>
        </div>
      </div>
    </footer>
  );
}
