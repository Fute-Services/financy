import Link from 'next/link';

/**
 * The public landing page.
 *
 * Written from `docs/01-PRODUCT-REQUIREMENTS.md`, and **nothing on it is
 * invented**. There are no customer counts, no logos, no "trusted by", no
 * transaction volumes — a pre-release product claiming any of those is
 * fabricating a record, and the one thing a spend-control product cannot
 * afford to do is overstate itself on the page that sets expectations.
 *
 * What replaces them is the part that is verifiable: the ten questions the
 * product exists to answer, the engineering guarantees, and an honest status.
 */

const PILLARS = [
  {
    id: 'before',
    step: '01',
    heading: 'Before the spend',
    lead: 'Policy is data, not a wiki page.',
    body: 'A written rule set is evaluated before money leaves the business. The engine returns allow, require approval, or block — with the rules that fired and the version they came from, recorded against the request.',
  },
  {
    id: 'during',
    step: '02',
    heading: 'As it is spent',
    lead: 'Evidence is captured at the moment, not chased later.',
    body: 'The receipt, the category, the project, and the reason attach to the transaction while the person still remembers what it was for — instead of being reconstructed from an inbox six weeks on.',
  },
  {
    id: 'after',
    step: '03',
    heading: 'After the spend',
    lead: 'Close becomes a review, not an excavation.',
    body: 'Reconciliation reads an already-complete record. Every figure traces back through approval, policy version, and receipt to the person who asked for it.',
  },
];

const QUESTIONS = [
  'Who spent the money?',
  'What was purchased, and why?',
  'Which team, project, or entity paid?',
  'Was it allowed under policy?',
  'Who approved it, and on what basis?',
  'What receipt proves it?',
  'How much budget remains?',
  'Where does it post in accounting?',
  'Can the history be audited without asking a human?',
];

const GUARANTEES = [
  {
    heading: 'Money is never a float',
    body: '`NUMERIC(20,4)` in the database, a `Money` value object in the domain, and a string with an explicit currency on the wire. `JSON.parse` produces doubles, so a monetary JSON number is already wrong by the time anything reads it.',
  },
  {
    heading: 'Four layers of tenant isolation',
    body: 'The organisation comes from the session and never from the request. A composite foreign key makes a cross-tenant reference structurally impossible — not merely checked. Cross-tenant reads return 404, never 403, because a 403 confirms the record exists.',
  },
  {
    heading: 'The audit trail cannot be edited',
    body: 'Every privileged mutation writes an audit event inside the same transaction as the change: either both commit or neither does. The database role holds no UPDATE or DELETE grant on the table, so there is no code path that could rewrite history.',
  },
  {
    heading: 'One policy engine, one approval machine',
    body: 'Spend requests, expenses, bills, and purchase orders all traverse the same evaluator and the same state machine. A second implementation would be a design failure, and a test asserts there is not one.',
  },
];

export default function LandingPage(): React.JSX.Element {
  return (
    <main>
      {/* ── Hero ────────────────────────────────────────────────────────── */}
      <section className="border-b border-white/10">
        <div className="mx-auto max-w-[1200px] px-6 pt-24 pb-20 md:pt-32 md:pb-28">
          <p className="text-[12px] font-semibold tracking-[0.18em] text-white/45 uppercase">
            Company spend management
          </p>

          <h1 className="mt-6 max-w-4xl text-[clamp(2.5rem,6.5vw,4.75rem)] leading-[1.02] font-semibold tracking-[-0.03em]">
            Most companies discover
            <br />
            their spending
            <span className="text-white/40"> after it has already happened.</span>
          </h1>

          <p className="mt-8 max-w-2xl text-[17px] leading-relaxed text-white/65">
            Financy moves the decision forward. Spend is authorised against written policy{' '}
            <em className="text-white not-italic">before</em> money leaves the business, evidence is
            captured <em className="text-white not-italic">as</em> it is spent, and reconciliation
            becomes a review of a record that is already complete.
          </p>

          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/register"
              className="bg-white px-6 py-3.5 text-[14px] font-medium text-[#0b1120] transition-colors hover:bg-white/90"
            >
              Create an organisation
            </Link>
            <Link
              href="/login"
              className="border border-white/25 px-6 py-3.5 text-[14px] font-medium text-white transition-colors hover:border-white/50"
            >
              Sign in
            </Link>
          </div>

          <p className="mt-6 text-[13px] text-white/40">
            Control, evidence, and record in one system — because in three systems the problem
            returns.
          </p>
        </div>
      </section>

      {/* ── The three moments ───────────────────────────────────────────── */}
      <section id="control" className="border-b border-white/10">
        <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
          <SectionLabel>Where control belongs</SectionLabel>

          <div className="mt-14 grid gap-px bg-white/10 md:grid-cols-3">
            {PILLARS.map((pillar) => (
              <article key={pillar.id} className="bg-[#0b1120] p-8 md:p-9">
                <span className="text-[12px] font-semibold tracking-[0.18em] text-white/30">
                  {pillar.step}
                </span>
                <h3 className="mt-6 text-[19px] font-semibold tracking-tight">{pillar.heading}</h3>
                <p className="mt-3 text-[15px] font-medium text-white/80">{pillar.lead}</p>
                <p className="mt-3 text-[14px] leading-relaxed text-white/55">{pillar.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── The ten questions ───────────────────────────────────────────── */}
      <section id="record" className="border-b border-white/10">
        <div className="mx-auto grid max-w-[1200px] gap-14 px-6 py-20 md:grid-cols-[1fr_1.15fr] md:py-28">
          <div>
            <SectionLabel>The test</SectionLabel>
            <h2 className="mt-6 text-[clamp(1.9rem,3.6vw,2.75rem)] leading-[1.1] font-semibold tracking-[-0.02em]">
              For any unit of spend, instantly and completely.
            </h2>
            <p className="mt-6 max-w-md text-[15px] leading-relaxed text-white/60">
              A feature that does not help answer one of these is not a Financy feature. It is the
              scope rule the product is actually built to, not a slogan.
            </p>
          </div>

          <ul className="divide-y divide-white/10 border-y border-white/10">
            {QUESTIONS.map((question, index) => (
              <li key={question} className="flex items-baseline gap-5 py-4">
                <span className="w-6 shrink-0 text-[12px] font-medium text-white/30 tabular-nums">
                  {String(index + 1).padStart(2, '0')}
                </span>
                <span className="text-[15px] text-white/85">{question}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── The failure it prevents ─────────────────────────────────────── */}
      <section id="how" className="border-b border-white/10">
        <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
          <SectionLabel>Why it fails without this</SectionLabel>
          <h2 className="mt-6 max-w-3xl text-[clamp(1.9rem,3.6vw,2.75rem)] leading-[1.1] font-semibold tracking-[-0.02em]">
            Finance operations break in a predictable sequence.
          </h2>

          <div className="mt-14 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-left">
              <thead>
                <tr className="border-b border-white/15">
                  <th className="py-3 pr-6 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
                    Stage
                  </th>
                  <th className="py-3 pr-6 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
                    What breaks
                  </th>
                  <th className="py-3 text-[11px] font-semibold tracking-wider text-white/40 uppercase">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {[
                  [
                    'Before spend',
                    'Policy lives in a wiki page nobody reads. Approvals happen in chat.',
                    'Unbudgeted commitments; no enforcement.',
                  ],
                  [
                    'At spend',
                    'Shared cards, personal cards, ad-hoc invoices. No context captured.',
                    'Nobody knows what a charge was for.',
                  ],
                  [
                    'After spend',
                    'Receipts chased weeks later. Categorisation done from memory.',
                    'Close takes days; errors are systemic.',
                  ],
                  [
                    'Reporting',
                    'Spreadsheets exported from four systems and merged by hand.',
                    'Numbers are stale and contested.',
                  ],
                  [
                    'Audit',
                    'History is reconstructed from inboxes.',
                    'Audit findings; no defensible trail.',
                  ],
                ].map(([stage, breaks, cost]) => (
                  <tr key={stage}>
                    <td className="py-5 pr-6 align-top text-[14px] font-medium whitespace-nowrap">
                      {stage}
                    </td>
                    <td className="py-5 pr-6 align-top text-[14px] text-white/65">{breaks}</td>
                    <td className="py-5 align-top text-[14px] text-white/65">{cost}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="mt-10 max-w-2xl text-[15px] leading-relaxed text-white/60">
            The root cause is that control, evidence, and record live in different systems — and
            frequently in no system at all. They have to be one system, joined by a single domain
            model, or the problem comes back.
          </p>
        </div>
      </section>

      {/* ── Engineering guarantees ──────────────────────────────────────── */}
      <section id="engineering" className="border-b border-white/10">
        <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
          <SectionLabel>Enforced, not documented</SectionLabel>
          <h2 className="mt-6 max-w-3xl text-[clamp(1.9rem,3.6vw,2.75rem)] leading-[1.1] font-semibold tracking-[-0.02em]">
            The guarantees are database constraints and lint rules.
          </h2>
          <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-white/60">
            Discipline that is not mechanised is not discipline. Each of these is enforced by
            something that fails a build or refuses a write — not by a convention someone has to
            remember.
          </p>

          <div className="mt-14 grid gap-px bg-white/10 sm:grid-cols-2">
            {GUARANTEES.map((guarantee) => (
              <article key={guarantee.heading} className="bg-[#0b1120] p-8 md:p-9">
                <h3 className="text-[17px] font-semibold tracking-tight">{guarantee.heading}</h3>
                <p className="mt-3 text-[14px] leading-relaxed text-white/60">{guarantee.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── Honest status ───────────────────────────────────────────────── */}
      <section id="roadmap">
        <div className="mx-auto max-w-[1200px] px-6 py-20 md:py-28">
          <div className="border border-white/15 p-8 md:p-12">
            <SectionLabel>Where it actually is</SectionLabel>

            <h2 className="mt-6 max-w-3xl text-[clamp(1.6rem,3vw,2.25rem)] leading-[1.15] font-semibold tracking-[-0.02em]">
              Pre-release, and specific about it.
            </h2>

            <p className="mt-6 max-w-2xl text-[15px] leading-relaxed text-white/60">
              Identity, tenancy, and the audit trail work end to end today — you can create an
              organisation and sign in right now. Policy and approvals, receipts and expenses, and
              budgets and reporting are designed in full and built in dependency order, because an
              approval has no authority until identity and permissions exist.
            </p>

            <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/60">
              Card issuing and payment execution run against sandbox adapters, labelled as sandbox
              in the API and in the interface. The product never implies money moved when only a
              record was created.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link
                href="/register"
                className="bg-white px-6 py-3.5 text-[14px] font-medium text-[#0b1120] transition-colors hover:bg-white/90"
              >
                Create an organisation
              </Link>
              <Link
                href="/login"
                className="border border-white/25 px-6 py-3.5 text-[14px] font-medium text-white transition-colors hover:border-white/50"
              >
                Sign in
              </Link>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="text-[11px] font-semibold tracking-[0.18em] text-white/40 uppercase">
      {children}
    </p>
  );
}
