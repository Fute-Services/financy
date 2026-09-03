import type { Metadata } from 'next';

import { POSTS } from '@/components/marketing/content';
import { Container, PageHero, RuledList, RuledRow } from '@/components/marketing/primitives';
import { EYEBROW, MONO } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Writing',
  description: 'Notes on controls, close and card policy, written by the people who build the modules.',
};

export default function WritingPage(): React.JSX.Element {
  return (
    <>
      <PageHero
        eyebrow="Writing"
        title="Notes on controls, close and card policy"
        lead="Written by the people who build the modules, mostly in response to questions from finance teams."
      />

      <section className="pt-12 pb-20 md:pt-14 md:pb-26">
        <Container>
          <RuledList>
            {POSTS.map((post) => (
              <RuledRow
                key={post.title}
                href="/contact"
                cols="md:grid-cols-[110px_1fr_120px]"
                className="md:items-baseline md:py-7"
              >
                <span className={EYEBROW}>{post.kind}</span>

                <span>
                  <span className="block text-[20px] font-semibold tracking-[-0.025em] md:text-[22px]">
                    {post.title}
                  </span>
                  <span className="mt-1.5 block max-w-[640px] text-[15px] leading-[1.55] text-[#4B4F58]">
                    {post.body}
                  </span>
                </span>

                <span className={`${MONO} text-[11px] text-[#9A9EA8] md:text-right`}>
                  {post.date}
                </span>
              </RuledRow>
            ))}
          </RuledList>
        </Container>
      </section>
    </>
  );
}
