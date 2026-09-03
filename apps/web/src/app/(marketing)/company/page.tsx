import type { Metadata } from 'next';

import { STATS, TIMELINE, VALUES } from '@/components/marketing/content';
import {
  Container,
  PageHero,
  PrimaryLink,
  QuietLink,
  RuledCell,
  RuledColumns,
  SectionHead,
} from '@/components/marketing/primitives';
import { LINE, MONO } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Company',
  description: 'Forty people working on the least glamorous and most load-bearing part of a company’s finances.',
};

export default function CompanyPage(): React.JSX.Element {
  return (
    <>
      <PageHero
        eyebrow="Company"
        title="We build the controls we wanted ourselves"
        lead="Forty people across Bengaluru and Mumbai, working on the least glamorous and most load-bearing part of a company’s finances."
      />

      <section className="pt-14 md:pt-16">
        <Container>
          <RuledColumns>
            {STATS.map((stat) => (
              <RuledCell key={stat.k}>
                <div className="text-[36px] leading-none font-semibold tracking-[-0.045em] tabular-nums md:text-[44px]">
                  {stat.k}
                </div>
                <div className="mt-3 max-w-[190px] text-[14px] leading-[1.45] text-[#4B4F58]">
                  {stat.v}
                </div>
              </RuledCell>
            ))}
          </RuledColumns>
        </Container>
      </section>

      <section className="pt-20 md:pt-22">
        <Container>
          <SectionHead title="How we got here" className="mb-9" />

          <div style={{ borderTop: `1px solid ${LINE}` }}>
            {TIMELINE.map((entry) => (
              <div
                key={entry.year}
                className="grid grid-cols-1 gap-1 py-5 md:grid-cols-[120px_1fr] md:items-baseline md:gap-10"
                style={{ borderBottom: `1px solid ${LINE}` }}
              >
                <span className={`${MONO} text-[13px] text-[#9A9EA8]`}>{entry.year}</span>
                <span className="max-w-[720px] text-[16.5px] leading-[1.55]">{entry.body}</span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="pt-20 pb-20 md:pb-26">
        <Container>
          <RuledColumns columns="lg:grid-cols-3" topBorder>
            {VALUES.map((value) => (
              <RuledCell key={value.num} className="md:px-8 md:py-8">
                <div className={`${MONO} mb-4.5 text-[12px] text-[#9A9EA8]`}>{value.num}</div>
                <h2 className="m-0 mb-2.5 text-[20px] font-semibold tracking-[-0.02em]">
                  {value.title}
                </h2>
                <p className="m-0 text-[15px] leading-[1.6] text-[#4B4F58]">{value.body}</p>
              </RuledCell>
            ))}
          </RuledColumns>

          <div className="mt-12 flex flex-wrap items-center gap-5">
            <PrimaryLink href="/careers" className="bg-[#14161A] hover:bg-[#2B39C4]">
              See open roles
            </PrimaryLink>
            <QuietLink href="/contact">Talk to us</QuietLink>
          </div>
        </Container>
      </section>
    </>
  );
}
