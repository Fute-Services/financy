import type { Metadata } from 'next';
import Link from 'next/link';

import { API_SAMPLE, DOC_SECTIONS } from '@/components/marketing/content';
import { Container, PageHero } from '@/components/marketing/primitives';
import { LINE, MONO } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Documentation',
  description: 'One REST API for cards, charges and policy. Everything the dashboard does is available over the API.',
};

export default function DocsPage(): React.JSX.Element {
  return (
    <>
      <PageHero
        eyebrow="Documentation"
        title="One REST API for cards, charges and policy"
        lead="Keys are scoped per environment. Everything the dashboard does is available over the API."
      />

      <section className="pt-10 md:pt-12">
        <Container>
          <div
            className={`${MONO} overflow-x-auto bg-[#14161A] px-6 py-6 text-[13px] leading-[1.9] text-[#E7E9F0]`}
            style={{ border: `1px solid ${LINE}` }}
          >
            <div className="mb-3.5 text-[10.5px] tracking-[0.12em] uppercase text-[#8E93A0]">
              Create a virtual card
            </div>
            <pre className="m-0 font-[inherit] whitespace-pre">
              <code>{API_SAMPLE.join('\n')}</code>
            </pre>
          </div>
        </Container>
      </section>

      <section className="pt-12 pb-20 md:pt-14 md:pb-26">
        <Container>
          <div style={{ borderTop: `1px solid ${LINE}` }}>
            {DOC_SECTIONS.map((section) => (
              <div
                key={section.num}
                className="grid grid-cols-1 gap-3 py-6 md:grid-cols-[60px_260px_1fr_260px] md:items-baseline md:gap-8 md:py-7"
                style={{ borderBottom: `1px solid ${LINE}` }}
              >
                <span className={`${MONO} text-[12px] text-[#9A9EA8]`}>{section.num}</span>
                <span className="text-[20px] font-semibold tracking-[-0.022em]">
                  {section.title}
                </span>
                <span className="max-w-[480px] text-[15.5px] leading-[1.6] text-[#4B4F58]">
                  {section.body}
                </span>
                <span className="flex flex-row flex-wrap gap-x-5 gap-y-1.5 md:flex-col">
                  {section.links.map((link) => (
                    <Link
                      key={link}
                      href="/contact"
                      className={`${MONO} text-[11.5px] text-[#2B39C4] hover:underline`}
                    >
                      {link}
                    </Link>
                  ))}
                </span>
              </div>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
