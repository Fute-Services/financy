import type { Metadata } from 'next';
import Link from 'next/link';

import { FAQS, PLAN_COMPARISON, PLANS } from '@/components/marketing/content';
import { Container, PageHero, SectionHead } from '@/components/marketing/primitives';
import { EYEBROW, LINE, LINE_FAINT, LINE_SOFT } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Per user, per month. No card fees, no minimum balance, and interchange rebated against your subscription.',
};

/**
 * Pricing.
 *
 * The three plans are columns of one table rather than three cards, so they are
 * read across rather than compared one at a time — which is what somebody
 * choosing between them is actually doing. Only Growth carries the filled
 * button; two primary actions in a row of three means the recommendation is not
 * a recommendation.
 */
export default function PricingPage(): React.JSX.Element {
  return (
    <>
      <PageHero
        eyebrow="Pricing"
        title="Per user, per month. Nothing on the spend."
        lead="No card fees, no minimum balance, no charge for adding an accountant. Interchange is rebated against your subscription."
        bordered={false}
      />

      <section>
        <Container>
          <div
            className="grid grid-cols-1 lg:grid-cols-3"
            style={{ borderTop: `1px solid ${LINE}` }}
          >
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className="flex flex-col px-0 py-8 md:px-8 md:pt-[34px] md:pb-9"
                style={{ borderLeft: `1px solid ${LINE}`, borderBottom: `1px solid ${LINE}` }}
              >
                <div className="text-[15px] font-semibold tracking-[-0.01em]">{plan.name}</div>

                <div className="mt-[22px] flex items-baseline gap-2">
                  <span className="text-[46px] leading-none font-semibold tracking-[-0.045em] tabular-nums">
                    {plan.price}
                  </span>
                  <span className="text-[13.5px] text-[#7A7E88]">{plan.unit}</span>
                </div>

                <p className="mt-5 mb-[26px] text-[15px] leading-[1.6] text-[#4B4F58]">
                  {plan.body}
                </p>

                <div className="mb-7 flex flex-col" style={{ borderTop: `1px solid ${LINE_SOFT}` }}>
                  {plan.items.map((item) => (
                    <div
                      key={item}
                      className="py-[11px] text-[14px]"
                      style={{ borderBottom: `1px solid ${LINE_FAINT}` }}
                    >
                      {item}
                    </div>
                  ))}
                </div>

                <div className="mt-auto">
                  <Link
                    href={plan.href}
                    className={
                      plan.primary
                        ? 'block rounded-md border border-[#2B39C4] bg-[#2B39C4] py-3 text-center text-[14.5px] font-semibold text-white transition-colors hover:border-[#1F2BA3] hover:bg-[#1F2BA3]'
                        : 'block rounded-md border border-[rgba(20,22,26,0.24)] py-3 text-center text-[14.5px] font-semibold text-[#14161A] transition-colors hover:border-[#2B39C4] hover:text-[#2B39C4]'
                    }
                  >
                    {plan.cta}
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="pt-20 md:pt-22">
        <Container>
          <SectionHead title="Compare plans" className="mb-9" />

          <div style={{ borderTop: `1px solid ${LINE}` }}>
            <div
              className={`${EYEBROW} hidden grid-cols-[1.6fr_1fr_1fr_1fr] gap-6 py-3.5 md:grid`}
              style={{ borderBottom: `1px solid ${LINE}` }}
            >
              <span />
              <span>Starter</span>
              <span>Growth</span>
              <span>Enterprise</span>
            </div>

            {PLAN_COMPARISON.map((row) => (
              <div
                key={row.k}
                className="grid grid-cols-1 gap-1 py-4 text-[14.5px] md:grid-cols-[1.6fr_1fr_1fr_1fr] md:gap-6"
                style={{ borderBottom: `1px solid ${LINE_SOFT}` }}
              >
                <span className="font-medium md:font-normal">{row.k}</span>
                <span className="text-[#4B4F58]">
                  <span className="text-[#9A9EA8] md:hidden">Starter · </span>
                  {row.a}
                </span>
                <span className="text-[#4B4F58]">
                  <span className="text-[#9A9EA8] md:hidden">Growth · </span>
                  {row.b}
                </span>
                <span className="text-[#4B4F58]">
                  <span className="text-[#9A9EA8] md:hidden">Enterprise · </span>
                  {row.c}
                </span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 md:pt-20 md:pb-26">
        <Container>
          <div className="grid gap-8 md:grid-cols-[1fr_1.4fr] md:gap-20">
            <SectionHead title="Common questions" />

            <div style={{ borderTop: `1px solid ${LINE}` }}>
              {FAQS.map((faq) => (
                <div key={faq.q} className="py-6" style={{ borderBottom: `1px solid ${LINE}` }}>
                  <div className="mb-2 text-[17px] font-semibold tracking-[-0.015em]">{faq.q}</div>
                  <p className="m-0 max-w-[620px] text-[15.5px] leading-[1.6] text-[#4B4F58]">
                    {faq.a}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
