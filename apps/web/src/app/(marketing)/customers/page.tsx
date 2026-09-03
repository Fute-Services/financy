import type { Metadata } from 'next';

import { CASE_STUDIES } from '@/components/marketing/content';
import { Container, PageHero, RuledList, RuledRow } from '@/components/marketing/primitives';
import { MONO } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Customers',
  description: 'Six finance teams, the control they were missing, and the number that moved because of it.',
};

export default function CustomersPage(): React.JSX.Element {
  return (
    <>
      <PageHero
        eyebrow="Customers"
        title="What changed after the first quarter"
        lead="Six finance teams, the control they were missing, and the number that moved because of it."
      />

      <section className="pt-12 pb-20 md:pt-14 md:pb-26">
        <Container>
          <RuledList>
            {CASE_STUDIES.map((study) => (
              <RuledRow
                key={study.num}
                href="/contact"
                cols="md:grid-cols-[60px_220px_1fr_200px]"
                className="md:items-baseline"
              >
                <span className={`${MONO} text-[12px] text-[#9A9EA8]`}>{study.num}</span>

                <span>
                  <span className="block text-[22px] font-semibold tracking-[-0.025em]">
                    {study.co}
                  </span>
                  <span className="mt-1 block text-[13px] text-[#7A7E88]">{study.industry}</span>
                </span>

                <span className="max-w-[520px] text-[15.5px] leading-[1.55] text-[#4B4F58]">
                  {study.body}
                </span>

                <span className="text-[19px] font-semibold tracking-[-0.02em] tabular-nums text-[#2B39C4] md:text-right">
                  {study.metric}
                </span>
              </RuledRow>
            ))}
          </RuledList>
        </Container>
      </section>
    </>
  );
}
