import Link from 'next/link';

import {
  APP_BARS,
  APP_CARDS,
  APP_NAV,
  HOME_HEADLINE,
  HOME_LEAD,
  MODULES,
} from '@/components/marketing/content';
import {
  Container,
  PrimaryLink,
  QuietLink,
  RuledList,
  RuledRow,
  SectionHead,
} from '@/components/marketing/primitives';
import { EYEBROW, LINE, LINE_DARK, LINE_FAINT, LINE_SOFT, MONO } from '@/components/marketing/theme';

/**
 * The landing page.
 *
 * The hero says what the product does and then immediately shows it. The
 * screenshot is not a screenshot — it is the real dashboard rebuilt in markup,
 * with the same figures the demo organisation actually holds. An image would
 * go stale the first time the product's own chart changed, and would be
 * unreadable at any width other than the one it was captured at.
 */
export default function HomePage(): React.JSX.Element {
  return (
    <>
      <section className="pt-16 md:pt-24">
        <Container>
          <div className="grid items-end gap-10 md:grid-cols-[1.35fr_1fr] md:gap-20">
            <h1 className="m-0 text-[46px] leading-[0.98] font-semibold tracking-[-0.04em] text-balance sm:text-[62px] lg:text-[82px]">
              {HOME_HEADLINE}
            </h1>
            <div className="md:pb-2">
              <p className="m-0 mb-[26px] max-w-[380px] text-[17px] leading-[1.55] text-pretty text-[#4B4F58]">
                {HOME_LEAD}
              </p>
              {/*
               * Self-serve first. The Starter plan is free and needs no
               * conversation, so the hero should not send everyone who wants
               * it through sales — the demo stays one click away beside it.
               */}
              <div className="flex flex-wrap items-center gap-5">
                <PrimaryLink href="/register">Create an organisation</PrimaryLink>
                <QuietLink href="/contact">Book a demo</QuietLink>
                <QuietLink href="/product">See the product</QuietLink>
              </div>
            </div>
          </div>
        </Container>
      </section>

      <ProductMock />

      <section className="pt-20 md:pt-26">
        <Container>
          <SectionHead
            title="Six modules, one ledger"
            lead="Each one works on its own. Run them together and there is nothing to reconcile between them."
            className="mb-14"
          />

          <RuledList>
            {MODULES.map((module) => (
              <RuledRow
                key={module.num}
                href="/product"
                cols="md:grid-cols-[60px_300px_1fr_110px]"
                className="md:items-baseline"
              >
                <span className={`${MONO} text-[12px] text-[#9A9EA8]`}>{module.num}</span>
                <span className="text-[22px] font-semibold tracking-[-0.025em] md:text-[24px]">
                  {module.title}
                </span>
                <span className="max-w-[520px] text-[15.5px] leading-[1.55] text-[#4B4F58]">
                  {module.body}
                </span>
                <span className={`${EYEBROW} md:text-right`}>{module.tag}</span>
              </RuledRow>
            ))}
          </RuledList>
        </Container>
      </section>

      <Close />
    </>
  );
}

/**
 * The closing band.
 *
 * It replaces the "Recognition" band that used to end this page with invented
 * awards and press names. Something has to sit here: the modules list ended
 * flush against the footer, which reads as a page that was cut off rather than
 * one that finished.
 *
 * It is the one inverted band on the site, so the ending reads in a different
 * register from everything above it — and it says the only thing there is
 * honestly to say at the end of a landing page, which is what to do next.
 */
function Close(): React.JSX.Element {
  return (
    <section className="mt-20 bg-[#14161A] text-[#EDEEF1] md:mt-26">
      <Container className="py-20 md:py-24">
        <div className="grid items-end gap-10 md:grid-cols-[1.2fr_1fr] md:gap-20">
          <h2 className="m-0 max-w-[560px] text-[32px] leading-[1.08] font-semibold tracking-[-0.035em] text-balance md:text-[40px]">
            Run it against your own last month of spend
          </h2>

          <div className="md:pb-1.5">
            <p className="m-0 mb-7 max-w-[380px] text-[16px] leading-[1.6] text-[#8E93A0]">
              Thirty minutes, your own transactions, and a straight answer on whether this fits. No
              slides.
            </p>

            <div className="flex flex-wrap items-center gap-6">
              {/*
                Plain links on both actions, not `PrimaryLink` and `QuietLink`.
                Both primitives hard-code colours for the light page — white
                text on cobalt, ink text on an ink underline — and a `className`
                override does not reliably win, because two Tailwind utilities
                of equal specificity are resolved by stylesheet order rather
                than by the order they appear in the attribute. The first
                attempt at this band shipped a white-on-white button for
                exactly that reason.
              */}
              <Link
                href="/contact"
                className="inline-block rounded-md bg-[#F6F5F2] px-[22px] py-3 text-[14.5px] font-semibold text-[#14161A] transition-colors hover:bg-white hover:text-[#2B39C4]"
              >
                Book a demo
              </Link>
              {/*
                A plain Link rather than `QuietLink`, which hard-codes an ink
                underline that is invisible on this band. Giving the shared
                primitive a dark variant for one call site would be more
                surface than the six classes it saves.
              */}
              <Link
                href="/pricing"
                className="pb-0.5 text-[14.5px] font-semibold text-[#8E93A0] transition-colors hover:text-[#EDEEF1]"
                style={{ borderBottom: `1px solid ${LINE_DARK}` }}
              >
                See pricing
              </Link>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}

/**
 * The dashboard, rebuilt rather than screenshotted.
 *
 * Deliberately not interactive and not reachable by keyboard: it is a picture
 * of the product, and a picture that can be tabbed into traps somebody in a
 * decorative sidebar on their way to the footer. `aria-hidden` with a caption
 * beneath gives a screen reader the sentence instead.
 */
function ProductMock(): React.JSX.Element {
  return (
    <section className="pt-14 md:pt-18">
      <Container>
        <div
          className="grid overflow-hidden bg-white md:min-h-[540px] md:grid-cols-[208px_1fr]"
          style={{ border: `1px solid ${LINE}`, borderBottom: 'none' }}
          aria-hidden="true"
        >
          <div
            className="hidden bg-[#14161A] px-3 py-[18px] text-[#E7E9F0] md:block"
            style={{ borderRight: `1px solid ${LINE}` }}
          >
            <div className="flex items-center gap-[9px] px-2 pt-1 pb-5 text-[14px] font-semibold">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-[#2B39C4] text-[9.5px] font-semibold">
                AC
              </span>
              Acme Ltd
            </div>
            <div className="flex flex-col gap-px text-[13px]">
              {APP_NAV.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between rounded-[5px] px-2.5 py-2"
                  style={{
                    background: item.active ? 'rgba(43,57,196,0.28)' : 'transparent',
                    color: item.active ? '#F2F3F6' : 'rgba(231,233,240,0.6)',
                    fontWeight: item.active ? 600 : 400,
                  }}
                >
                  <span>{item.label}</span>
                  <span className="text-[11px] opacity-65">{item.badge}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-[#FBFBFA] px-5 py-6 md:px-[34px] md:pt-[30px] md:pb-10">
            <div className="text-[20px] font-semibold tracking-[-0.02em] md:text-[22px]">
              Good to see you, Grace
            </div>
            <div className="mt-1 text-[13.5px] text-[#6A6E78]">
              Everything below is across the organisation.
            </div>

            <div
              className="mt-6 grid grid-cols-2 bg-white lg:grid-cols-4"
              style={{ border: `1px solid ${LINE_SOFT}` }}
            >
              {APP_CARDS.map((card) => (
                <div
                  key={card.label}
                  className="px-[18px] pt-4 pb-5"
                  style={{ borderRight: `1px solid ${LINE_FAINT}` }}
                >
                  <div className={`${EYEBROW} tracking-[0.1em]`}>{card.label}</div>
                  <div className="mt-2.5 text-[25px] font-semibold tracking-[-0.03em] tabular-nums">
                    {card.value}
                  </div>
                  <div className="mt-1.5 text-[11.5px] text-[#7A7E88]">{card.sub}</div>
                </div>
              ))}
            </div>

            <div
              className="bg-white px-5 pt-[22px] pb-6 md:px-6"
              style={{ border: `1px solid ${LINE_SOFT}`, borderTop: 'none' }}
            >
              <div className="flex items-baseline justify-between">
                <div className="text-[14.5px] font-semibold">Spend, month by month</div>
                <div className={`${MONO} text-[10.5px] text-[#7A7E88]`}>6 MONTHS</div>
              </div>

              <div className="mt-6 grid grid-cols-6 items-end gap-3 md:gap-[22px]">
                {APP_BARS.map((bar) => (
                  <div key={bar.month} className="flex flex-col items-stretch gap-2.5">
                    <div
                      style={{
                        height: `${String(bar.height)}px`,
                        background: bar.partial ? '#B9BEE6' : '#2B39C4',
                      }}
                    />
                    <div
                      className={`${MONO} pt-2 text-[11px] tabular-nums`}
                      style={{ borderTop: `1px solid ${LINE_SOFT}` }}
                    >
                      {bar.amount}
                    </div>
                    <div className="-mt-1 text-[11px] text-[#7A7E88]">{bar.month}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
        <p className="sr-only">
          A view of the Financy dashboard showing spend this month, approvals awaiting a decision,
          missing receipts, and a six-month spend chart.
        </p>
      </Container>
    </section>
  );
}
