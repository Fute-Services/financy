import Link from 'next/link';

import { CONTAINER, EYEBROW, LINE, LINE_SOFT } from './theme';

/**
 * The shapes the public site is made of.
 *
 * Nearly every page is the same four moves: a hero with a mono eyebrow, a list
 * of bordered rows, a row of bordered columns, and a two-column block of
 * heading plus lead. Writing those once means a new page is content rather than
 * layout, and — more usefully — it means the eleventh page cannot drift a
 * border weight or a heading size away from the first.
 */

export function Container({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return <div className={`${CONTAINER} ${className}`}>{children}</div>;
}

export function Eyebrow({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <div className={EYEBROW}>{children}</div>;
}

/**
 * The standard page opening: eyebrow, headline, and a lead sitting on the
 * baseline beside it.
 *
 * `align="end"` is the default because the mock hangs the lead paragraph off
 * the bottom of the headline rather than the top — which keeps the two blocks
 * reading as one sentence broken across a column, not as two stacked things.
 */
export function PageHero({
  eyebrow,
  title,
  lead,
  bordered = true,
  wide = false,
}: {
  eyebrow?: string;
  title: string;
  lead?: string;
  bordered?: boolean;
  /** A headline with no lead beside it, spanning most of the measure. */
  wide?: boolean;
}): React.JSX.Element {
  return (
    <section
      className="pt-[72px] pb-12 md:pt-[88px] md:pb-16"
      style={bordered ? { borderBottom: `1px solid ${LINE}` } : undefined}
    >
      <Container>
        {eyebrow !== undefined && (
          <div className="mb-[26px]">
            <Eyebrow>{eyebrow}</Eyebrow>
          </div>
        )}

        {wide || lead === undefined ? (
          <h1 className="m-0 max-w-[820px] text-[40px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance md:text-[64px]">
            {title}
          </h1>
        ) : (
          <div className="grid items-end gap-8 md:grid-cols-[1.3fr_1fr] md:gap-20">
            <h1 className="m-0 text-[40px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance md:text-[64px]">
              {title}
            </h1>
            <p className="m-0 text-[16.5px] leading-[1.6] text-[#4B4F58] md:mb-2">{lead}</p>
          </div>
        )}
      </Container>
    </section>
  );
}

/** A heading and a lead side by side, used to open a section mid-page. */
export function SectionHead({
  title,
  lead,
  className = '',
}: {
  title: string;
  lead?: string;
  className?: string;
}): React.JSX.Element {
  if (lead === undefined) {
    return (
      <h2
        className={`m-0 text-[26px] leading-[1.1] font-semibold tracking-[-0.032em] md:text-[32px] ${className}`}
      >
        {title}
      </h2>
    );
  }

  return (
    <div className={`grid items-start gap-6 md:grid-cols-2 md:gap-20 ${className}`}>
      <h2 className="m-0 text-[32px] leading-[1.06] font-semibold tracking-[-0.035em] md:text-[44px]">
        {title}
      </h2>
      <p className="m-0 max-w-[420px] text-[16.5px] leading-[1.6] text-[#4B4F58] md:pt-2">
        {lead}
      </p>
    </div>
  );
}

/**
 * A list whose rows are separated by hairlines and nothing else.
 *
 * No cards, no shadows, no rounded corners. The whole site is built from ruled
 * lines because a finance buyer reads a bordered table as a record and a
 * floating card as an advertisement.
 */
export function RuledList({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={className} style={{ borderTop: `1px solid ${LINE}` }}>
      {children}
    </div>
  );
}

/**
 * One row of a ruled list.
 *
 * Becomes a link when `href` is given, and only then does it take the hover
 * treatment — the indent-and-tint that tells you a row goes somewhere. A row
 * that merely states a fact stays inert, so hovering the site never promises a
 * destination that is not there.
 */
export function RuledRow({
  children,
  href,
  cols,
  className = '',
}: {
  children: React.ReactNode;
  href?: string;
  /**
   * The grid template above `md`, as a Tailwind class —
   * e.g. `md:grid-cols-[60px_300px_1fr_110px]`.
   *
   * Passed as a class rather than an inline template so Tailwind can see it at
   * build time. Below `md` every row stacks to a single column, because these
   * templates are four-column ledger rows and there is no honest way to shrink
   * one onto a phone.
   */
  cols: string;
  className?: string;
}): React.JSX.Element {
  const shared = `grid grid-cols-1 gap-2 py-6 md:gap-8 md:py-[30px] ${cols} ${className}`;
  const style = { borderBottom: `1px solid ${LINE}` };

  if (href === undefined) {
    return (
      <div className={shared} style={style}>
        {children}
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={`${shared} px-2 transition-[background-color,padding] duration-150 hover:bg-[rgba(43,57,196,0.045)] md:hover:pl-5`}
      style={style}
    >
      {children}
    </Link>
  );
}

/**
 * Columns divided by vertical hairlines — stats, values, plans, solutions.
 *
 * The left border on every cell (rather than a gap) is what makes four numbers
 * read as one table instead of four unrelated boxes.
 */
export function RuledColumns({
  children,
  columns = 'md:grid-cols-4',
  topBorder = false,
  className = '',
}: {
  children: React.ReactNode;
  columns?: string;
  topBorder?: boolean;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={`grid grid-cols-1 sm:grid-cols-2 ${columns} ${className}`}
      style={topBorder ? { borderTop: `1px solid ${LINE}` } : undefined}
    >
      {children}
    </div>
  );
}

export function RuledCell({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div
      className={`px-0 py-6 md:px-7 md:py-0 ${className}`}
      style={{ borderLeft: `1px solid ${LINE}` }}
    >
      {children}
    </div>
  );
}

/** The filled primary action. One per view, wherever possible. */
export function PrimaryLink({
  href,
  children,
  className = '',
}: {
  href: string;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      className={`inline-block rounded-md bg-[#2B39C4] px-[22px] py-3 text-[14.5px] font-semibold text-white transition-colors hover:bg-[#1F2BA3] ${className}`}
    >
      {children}
    </Link>
  );
}

/** The quieter action beside it: underlined, not boxed. */
export function QuietLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Link
      href={href}
      className="pb-0.5 text-[14.5px] font-semibold text-[#14161A] transition-colors hover:text-[#2B39C4]"
      style={{ borderBottom: '1px solid rgba(20,22,26,0.3)' }}
    >
      {children}
    </Link>
  );
}

export { LINE, LINE_SOFT };
