import type { Metadata } from 'next';

import { PERKS, ROLES } from '@/components/marketing/content';
import {
  Container,
  PageHero,
  RuledCell,
  RuledColumns,
  RuledList,
  RuledRow,
} from '@/components/marketing/primitives';
import { EYEBROW } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Careers',
  description: 'Five roles open. We hire slowly and give people the whole module.',
};

export default function CareersPage(): React.JSX.Element {
  return (
    <>
      <PageHero
        eyebrow="Careers"
        title="Five roles open, all load-bearing"
        lead="We hire slowly and give people the whole module. If you like owning a surface end to end, this reads well."
      />

      <section className="pt-12 md:pt-14">
        <Container>
          <RuledList>
            {ROLES.map((role) => (
              <RuledRow
                key={role.title}
                href="/contact"
                cols="md:grid-cols-[1.5fr_1fr_1fr_120px]"
                className="md:items-baseline md:gap-6 md:py-6"
              >
                <span className="text-[19px] font-semibold tracking-[-0.022em] md:text-[20px]">
                  {role.title}
                </span>
                <span className="text-[14.5px] text-[#4B4F58]">{role.team}</span>
                <span className="text-[14.5px] text-[#4B4F58]">{role.loc}</span>
                <span className={`${EYEBROW} md:text-right`}>{role.type}</span>
              </RuledRow>
            ))}
          </RuledList>
        </Container>
      </section>

      <section className="pt-20 pb-20 md:pb-26">
        <Container>
          <RuledColumns columns="lg:grid-cols-3" topBorder>
            {PERKS.map((perk) => (
              <RuledCell key={perk.title} className="md:px-8 md:py-8">
                <h2 className="m-0 mb-2.5 text-[19px] font-semibold tracking-[-0.02em]">
                  {perk.title}
                </h2>
                <p className="m-0 text-[15px] leading-[1.6] text-[#4B4F58]">{perk.body}</p>
              </RuledCell>
            ))}
          </RuledColumns>
        </Container>
      </section>
    </>
  );
}
