import type { Metadata } from 'next';

import { CONTACT_FIELDS, CONTACT_ROWS } from '@/components/marketing/content';
import { Container, Eyebrow } from '@/components/marketing/primitives';
import { EYEBROW, LINE } from '@/components/marketing/theme';

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Thirty minutes, your last month of transactions, and a straight answer on whether this fits.',
};

/**
 * The demo request.
 *
 * The form posts nowhere yet — there is no lead endpoint behind it, and wiring
 * it to one that silently discards submissions would be worse than a form that
 * plainly has not been connected. Every field is labelled and typed correctly
 * so that connecting it later is one handler rather than a rewrite.
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

          <div className="bg-white p-6 md:p-8" style={{ border: `1px solid ${LINE}` }}>
            <form className="grid gap-[18px]">
              {CONTACT_FIELDS.map((field) => {
                const id = field.label.toLowerCase().replace(/\s+/g, '-');

                return (
                  <div key={field.label}>
                    <label htmlFor={id} className={`${EYEBROW} mb-2 block tracking-[0.1em]`}>
                      {field.label}
                    </label>
                    <input
                      id={id}
                      name={id}
                      type={field.type}
                      autoComplete={field.autoComplete}
                      placeholder={field.placeholder}
                      className="w-full rounded border border-[rgba(20,22,26,0.16)] bg-[#FBFBFA] px-3 py-[11px] text-[15px] outline-none focus:border-[#2B39C4]"
                    />
                  </div>
                );
              })}

              <div>
                <label htmlFor="brief" className={`${EYEBROW} mb-2 block tracking-[0.1em]`}>
                  What are you trying to fix?
                </label>
                <textarea
                  id="brief"
                  name="brief"
                  rows={4}
                  placeholder="Receipts, approvals, closing the month…"
                  className="w-full resize-y rounded border border-[rgba(20,22,26,0.16)] bg-[#FBFBFA] px-3 py-[11px] text-[15px] outline-none focus:border-[#2B39C4]"
                />
              </div>

              <button
                type="submit"
                className="mt-1 w-full rounded-md bg-[#2B39C4] py-[13px] text-[14.5px] font-semibold text-white transition-colors hover:bg-[#1F2BA3]"
              >
                Request a demo
              </button>
            </form>
          </div>
        </div>
      </Container>
    </section>
  );
}
