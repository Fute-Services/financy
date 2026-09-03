/**
 * The public site's visual language.
 *
 * A separate palette from the application's, on purpose. The product is a cool
 * near-white because people stare at it for eight hours; this is a warm paper
 * tone because somebody gives it thirty seconds and should feel they are
 * reading a document rather than operating a console.
 *
 * Values are literal rather than Tailwind tokens: the application's `ink` ramp
 * is tuned for dense data surfaces and reusing it here would drag the product's
 * register onto a page that deliberately does not share it.
 */

export const COLOR = {
  /** Warm paper. The page sits on this everywhere except the dark bands. */
  page: '#F6F5F2',
  surface: '#FFFFFF',
  /** The panel inside the product mock, a half-step off white. */
  surfaceMuted: '#FBFBFA',

  ink: '#14161A',
  body: '#4B4F58',
  muted: '#7A7E88',
  faint: '#9A9EA8',

  /** Interactive intent, and the only saturated colour on the page. */
  accent: '#2B39C4',
  accentHover: '#1F2BA3',

  /** Inverted bands — the recognition strip, the API sample, the app sidebar. */
  dark: '#14161A',
  darkInk: '#EDEEF1',
  darkMuted: '#8E93A0',

  positive: '#1E7A4A',
} as const;

/**
 * Hairlines.
 *
 * Three weights, and the difference between them is doing real work: `line`
 * separates sections, `lineSoft` separates rows inside one, `lineFaint`
 * separates cells inside a row. Collapsing them to one weight makes a table of
 * anything read as an undifferentiated grid.
 */
export const LINE = 'rgba(20,22,26,0.14)';
export const LINE_SOFT = 'rgba(20,22,26,0.12)';
export const LINE_FAINT = 'rgba(20,22,26,0.08)';
export const LINE_DARK = 'rgba(237,238,241,0.18)';
export const LINE_DARK_SOFT = 'rgba(237,238,241,0.14)';

/** 1240px of content with 40px gutters, on every single page. */
export const CONTAINER = 'mx-auto w-full max-w-[1240px] px-6 md:px-10';

/**
 * The mono label that captions almost every section.
 *
 * Uppercase, tracked, and small. It is the one place the site uses a second
 * typeface, and it earns it by marking every "you are here" in the same way.
 */
/**
 * IBM Plex Mono, as loaded by the marketing layout.
 *
 * Written as an explicit family-name so it resolves to the route group's font
 * variable rather than Tailwind's default mono stack — the two are different
 * typefaces and mixing them across a page is visible at the label sizes this
 * site uses.
 */
export const MONO = 'font-[family-name:var(--font-marketing-mono)]';

export const EYEBROW = `${MONO} text-[10.5px] uppercase tracking-[0.12em] text-[#7A7E88]`;
