import type { Metadata } from 'next';

import { CONTACT_ROWS } from '@/components/marketing/content';
import { Container, Eyebrow } from '@/components/marketing/primitives';
import { LINE } from '@/components/marketing/theme';

import { ContactForm } from './contact-form';

export const metadata: Metadata = {
  title: 'Contact',
  description:
    'Thirty minutes, your last month of transactions, and a straight answer on whether this fits.',
};

/**
 * The demo request.
 *
 * The form posts to `POST /v1/leads`, which records the submission and returns
 * nothing but an acknowledgement. It lives in {@link ContactForm} because it
 * needs the three states a static page cannot show — in flight, refused, and
 * accepted — and everything around it stays server-rendered.
 */
export default function ContactPage(): React.JSX.Element {
  return (
    <section className="pt-[72px] pb-20 md:pt-[88px] md:pb-28">
      <Container>
        <div className="grid gap-12 md:grid-cols-[1fr_480px] md:gap-24">
          <div>
            <div className="mb-[26px]">
              <Eyebrow>Contact</Eyebrow>
            </div>

            <h1 className="m-0 mb-5 text-[40px] leading-[1.02] font-semibold tracking-[-0.04em] text-balance md:text-[56px]">
              Run it against your own spend
            </h1>

            <p className="m-0 mb-11 max-w-[460px] text-[17px] leading-[1.6] text-[#4B4F58]">
              Thirty minutes, your last month of transactions, and a straight answer on whether this
              fits. No slides.
            </p>

            <div style={{ borderTop: `1px solid ${LINE}` }}>
              {CONTACT_ROWS.map((row) => (
                <div
                  key={row.k}
                  className="flex justify-between gap-6 py-4 text-[14.5px]"
                  style={{ borderBottom: `1px solid ${LINE}` }}
                >
                  <span className="text-[#7A7E88]">{row.k}</span>
                  <span>{row.v}</span>
                </div>
              ))}
            </div>
          </div>

          <ContactForm />
        </div>
      </Container>
    </section>
  );
}
