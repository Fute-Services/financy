import type { Metadata } from 'next';

import { FEATURES } from '@/components/marketing/content';
import { Container, PageHero } from '@/components/marketing/primitives';
import { EYEBROW, LINE_SOFT, MONO } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Product',
  description:
    'Everything sits on the same ledger, so a charge is coded once and never re-entered.',
};

/**
 * The product page.
 *
 * Six modules, each given the same three-part row: what it is called, what it
 * does in a paragraph, and the three specifics somebody evaluating it will ask
 * about. The specifics sit under a rule rather than in a bulleted list, because
 * a bullet reads as marketing and a ruled column reads as a specification.
 */
export default function ProductPage(): React.JSX.Element {
  return (
    <>
      <PageHero
        eyebrow="Product"
        title="From the swipe to the closed book"
        lead="Everything below sits on the same ledger, so a charge is coded once and never re-entered."
      />

      <section className="pb-20 md:pb-26">
        <Container>
          {FEATURES.map((feature) => (
            <div
              key={feature.num}
              className="grid grid-cols-1 gap-5 py-9 md:grid-cols-[60px_280px_1fr] md:items-start md:gap-10 md:py-11"
              style={{ borderBottom: `1px solid ${LINE_SOFT}` }}
            >
              <span className={`${MONO} text-[12px] text-[#9A9EA8] md:pt-1.5`}>{feature.num}</span>

              <div>
                <div className={`${EYEBROW} mb-2.5`}>{feature.tag}</div>
                <h2 className="m-0 text-[24px] font-semibold tracking-[-0.028em] md:text-[26px]">
                  {feature.title}
                </h2>
              </div>

              <div>
                <p className="m-0 mb-5 max-w-[620px] text-[16px] leading-[1.65] text-[#4B4F58]">
                  {feature.body}
                </p>
                <div
                  className="flex flex-col gap-2 sm:flex-row sm:gap-0"
                  style={{ borderTop: `1px solid ${LINE_SOFT}` }}
                >
                  {feature.points.map((point) => (
                    <div key={point} className="pt-3.5 pr-5 text-[14px] sm:flex-1">
                      {point}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </Container>
      </section>
    </>
  );
}
