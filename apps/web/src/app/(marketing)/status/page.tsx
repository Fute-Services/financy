import type { Metadata } from 'next';

import { INCIDENTS, SERVICES } from '@/components/marketing/content';
import { Container, Eyebrow, SectionHead } from '@/components/marketing/primitives';
import { LINE, MONO } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Status',
  description: 'Uptime for the trailing ninety days across card authorisation, the dashboard and the API.',
};

/**
 * The status page.
 *
 * The green dot is paired with the word "Operational" everywhere it appears —
 * a status page that encodes health in colour alone is unreadable to the eight
 * percent of men who cannot separate its two most important states.
 */
export default function StatusPage(): React.JSX.Element {
  return (
    <>
      <section className="pt-[72px] pb-12 md:pt-[88px] md:pb-14" style={{ borderBottom: `1px solid ${LINE}` }}>
        <Container>
          <div className="mb-[26px]">
            <Eyebrow>Status</Eyebrow>
          </div>

          <div className="flex items-center gap-3.5">
            <span aria-hidden="true" className="block h-2.5 w-2.5 rounded-full bg-[#1E7A4A]" />
            <h1 className="m-0 text-[36px] leading-[1.02] font-semibold tracking-[-0.04em] md:text-[56px]">
              All systems operational
            </h1>
          </div>

          <p className="mt-5 mb-0 text-[16.5px] text-[#4B4F58]">
            Uptime shown for the trailing ninety days. Card authorisation is measured against our
            issuing partner’s records.
          </p>
        </Container>
      </section>

      <section className="pt-10 md:pt-12">
        <Container>
          <div style={{ borderTop: `1px solid ${LINE}` }}>
            {SERVICES.map((service) => (
              <div
                key={service.k}
                className="grid grid-cols-1 gap-1 py-4 md:grid-cols-[1fr_200px_120px] md:items-center md:gap-8"
                style={{ borderBottom: `1px solid ${LINE}` }}
              >
                <span className="text-[16.5px] font-medium">{service.k}</span>
                <span className="flex items-center gap-2.5 text-[14.5px] text-[#1E7A4A]">
                  <span aria-hidden="true" className="block h-[7px] w-[7px] rounded-full bg-[#1E7A4A]" />
                  {service.v}
                </span>
                <span className={`${MONO} text-[12.5px] tabular-nums text-[#4B4F58] md:text-right`}>
                  {service.up}
                </span>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="pt-16 pb-20 md:pt-18 md:pb-26">
        <Container>
          <SectionHead title="Past incidents" className="mb-8" />

          <div style={{ borderTop: `1px solid ${LINE}` }}>
            {INCIDENTS.map((incident) => (
              <div
                key={incident.title}
                className="grid grid-cols-1 gap-2 py-6 md:grid-cols-[140px_1fr] md:items-baseline md:gap-8"
                style={{ borderBottom: `1px solid ${LINE}` }}
              >
                <span className={`${MONO} text-[11.5px] text-[#9A9EA8]`}>{incident.date}</span>
                <span>
                  <span className="block text-[18px] font-semibold tracking-[-0.02em]">
                    {incident.title}
                  </span>
                  <span className="mt-1.5 block max-w-[680px] text-[15.5px] leading-[1.6] text-[#4B4F58]">
                    {incident.body}
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
