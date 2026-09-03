import type { Metadata } from 'next';

import { PRIVACY_SECTIONS, LEGAL_UPDATED } from '@/components/marketing/content';
import { Container, Eyebrow } from '@/components/marketing/primitives';
import { LINE, MONO } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Privacy policy',
  description: 'What Financy collects, why it is held, who sees it and how long it is kept.',
};

export default function PrivacyPage(): React.JSX.Element {
  return (
    <>
      <section
        className="pt-[72px] pb-12 md:pt-[88px] md:pb-14"
        style={{ borderBottom: `1px solid ${LINE}` }}
      >
        <Container>
          <div className="mb-[26px]">
            <Eyebrow>Privacy policy</Eyebrow>
          </div>

          <div className="grid items-end gap-4 md:grid-cols-[1.3fr_1fr] md:gap-20">
            <h1 className="m-0 text-[36px] leading-[1.03] font-semibold tracking-[-0.04em] text-balance md:text-[56px]">
              What we hold, and why
            </h1>
            <p className={`${MONO} m-0 text-[11.5px] text-[#7A7E88] md:mb-2`}>{LEGAL_UPDATED}</p>
          </div>
        </Container>
      </section>

      <section className="pt-10 pb-20 md:pt-12 md:pb-26">
        <Container>
          <div style={{ borderTop: `1px solid ${LINE}` }}>
            {PRIVACY_SECTIONS.map((section) => (
              <div
                key={section.num}
                className="grid grid-cols-1 gap-2 py-6 md:grid-cols-[60px_260px_1fr] md:items-baseline md:gap-10 md:py-7"
                style={{ borderBottom: `1px solid ${LINE}` }}
              >
                <span className={`${MONO} text-[12px] text-[#9A9EA8]`}>{section.num}</span>
                <h2 className="m-0 text-[19px] font-semibold tracking-[-0.022em]">
                  {section.title}
                </h2>
                <p className="m-0 max-w-[660px] text-[15.5px] leading-[1.65] text-[#4B4F58]">
                  {section.body}
                </p>
              </div>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
