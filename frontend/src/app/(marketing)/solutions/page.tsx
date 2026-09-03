import type { Metadata } from 'next';

import { SOLUTIONS } from '@/components/marketing/content';
import { Container, PageHero, RuledCell, RuledColumns } from '@/components/marketing/primitives';
import { MONO } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Solutions',
  description: 'Built for whoever owns the number — finance leads, controllers, managers and the people spending.',
};

export default function SolutionsPage(): React.JSX.Element {
  return (
    <>
      <PageHero eyebrow="Solutions" title="Built for whoever owns the number" />

      <section className="pb-20 md:pb-26">
        <Container>
          <RuledColumns columns="lg:grid-cols-3">
            {SOLUTIONS.map((solution) => (
              <RuledCell key={solution.num} className="md:px-8 md:pt-10 md:pb-11">
                <div className={`${MONO} mb-5 text-[12px] text-[#9A9EA8]`}>{solution.num}</div>
                <h2 className="m-0 mb-2.5 text-[21px] font-semibold tracking-[-0.022em]">
                  {solution.title}
                </h2>
                <p className="m-0 text-[15px] leading-[1.6] text-[#4B4F58]">{solution.body}</p>
              </RuledCell>
            ))}
          </RuledColumns>
        </Container>
      </section>
    </>
  );
}
