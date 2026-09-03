import type { Metadata } from 'next';

import { RELEASES } from '@/components/marketing/content';
import { Container, PageHero } from '@/components/marketing/primitives';
import { LINE, MONO } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Changelog',
  description: 'What shipped, most recent first.',
};

export default function ChangelogPage(): React.JSX.Element {
  return (
    <>
      <PageHero eyebrow="Changelog" title="What shipped, most recent first" />

      <section className="pt-12 pb-20 md:pt-14 md:pb-26">
        <Container>
          <div style={{ borderTop: `1px solid ${LINE}` }}>
            {RELEASES.map((release) => (
              <div
                key={release.title}
                className="grid grid-cols-1 gap-2 py-6 md:grid-cols-[140px_100px_1fr] md:items-baseline md:gap-8"
                style={{ borderBottom: `1px solid ${LINE}` }}
              >
                <span className={`${MONO} text-[11.5px] text-[#9A9EA8]`}>{release.date}</span>
                <span
                  className={`${MONO} text-[10.5px] tracking-[0.1em] uppercase text-[#2B39C4]`}
                >
                  {release.tag}
                </span>
                <span>
                  <span className="block text-[19px] font-semibold tracking-[-0.022em]">
                    {release.title}
                  </span>
                  <span className="mt-1.5 block max-w-[660px] text-[15.5px] leading-[1.6] text-[#4B4F58]">
                    {release.body}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </Container>
      </section>
    </>
  );
}
