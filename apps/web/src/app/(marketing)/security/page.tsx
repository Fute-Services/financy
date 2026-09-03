import type { Metadata } from 'next';

import { CERTIFICATIONS, SECURITY_PRACTICES } from '@/components/marketing/content';
import { Container, PageHero, SectionHead } from '@/components/marketing/primitives';
import { LINE, MONO } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Security',
  description: 'Card credentials are tokenised and never stored by us. Everything else is audited, logged and recoverable.',
};

export default function SecurityPage(): React.JSX.Element {
  return (
    <>
      <PageHero
        eyebrow="Security"
        title="Your money, held to the boring standard"
        lead="Card credentials are tokenised and never stored by us. Everything else is audited, logged and recoverable."
      />

      <section className="pt-12 md:pt-14">
        <Container>
          <div style={{ borderTop: `1px solid ${LINE}` }}>
            {CERTIFICATIONS.map((cert) => (
              <div
                key={cert.k}
                className="grid grid-cols-1 gap-1 py-5 md:grid-cols-[280px_1fr] md:items-baseline md:gap-10"
                style={{ borderBottom: `1px solid ${LINE}` }}
              >
                <span className="text-[17px] font-semibold tracking-[-0.015em]">{cert.k}</span>
                <span className="text-[15.5px] text-[#4B4F58]">{cert.v}</span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="pt-20 pb-20 md:pb-26">
        <Container>
          <SectionHead title="How it works in practice" className="mb-9" />

          <div style={{ borderTop: `1px solid ${LINE}` }}>
            {SECURITY_PRACTICES.map((practice) => (
              <div
                key={practice.num}
                className="grid grid-cols-1 gap-2 py-6 md:grid-cols-[60px_280px_1fr] md:items-baseline md:gap-10 md:py-7"
                style={{ borderBottom: `1px solid ${LINE}` }}
              >
                <span className={`${MONO} text-[12px] text-[#9A9EA8]`}>{practice.num}</span>
                <span className="text-[20px] font-semibold tracking-[-0.022em]">
                  {practice.title}
                </span>
                <span className="max-w-[620px] text-[15.5px] leading-[1.6] text-[#4B4F58]">
                  {practice.body}
                </span>
              </div>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
