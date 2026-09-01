import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * The vertical slice (Epic 2.7, and the journey in `docs/05 §0`).
 *
 * One organisation, one policy written through the rule builder, one request
 * that the policy routes to somebody else, and one approval. Every step in a
 * real browser against the real API.
 *
 * ## Why this one is worth its cost
 *
 * Everything below this level mocks something. The Supertest suites prove the
 * API's behaviour and the unit suites prove the evaluator's, but neither can
 * catch the failures that live in the seams:
 *
 * - a rule that the builder can express and the engine cannot read,
 * - a decision the API returns and the screen does not render,
 * - an approval queue that shows a step the approver cannot actually act on.
 *
 * Each of those passes every cheaper test in the repository.
 *
 * ## What it deliberately does not do
 *
 * It configures **one** scenario, not six. The other five are covered by the
 * golden files and the API suite, which can construct a merge conflict in
 * three lines and assert on the decision precisely — a browser test doing the
 * same would be six times slower and prove less about each one. What only a
 * browser can prove is that a person can get from an empty organisation to an
 * approved request without help, and that is what this asserts.
 */

const PASSWORD = 'correct-horse-battery-staple';
const JOINER_PASSWORD = 'another-correct-horse-staple';

async function registerOrganisation(page: Page, id: string): Promise<void> {
  await page.goto('/register');
  await page.fill('#organizationName', `Slice ${id}`);
  await page.fill('#fullName', 'Dana Requester');
  await page.fill('#email', `${id}@slice.test`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/overview');
}

/**
 * Invite somebody and accept it in a second browser context.
 *
 * Two contexts rather than one with a re-login: the approval has to be made by
 * a different session, and reusing the cookie jar would let a test pass that
 * only proved the requester can approve their own request — the one thing the
 * product must never allow.
 */
async function inviteFinanceAdmin(page: Page, id: string): Promise<string> {
  const email = `finance-${id}@slice.test`;

  await page.goto('/people');
  await page.getByRole('button', { name: 'Invite someone' }).click();

  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await dialog.getByRole('combobox', { name: 'Role', exact: true }).selectOption('FINANCE_ADMIN');
  await page.getByRole('button', { name: 'Send invitation' }).click();

  // The dialog stays open on success precisely so the one-time link can be
  // copied; the token exists in that response and nowhere else.
  const link = await dialog.getByRole('textbox', { name: 'Send them this link' }).inputValue();

  expect(link, 'the invite dialog should surface a one-time link').toContain('/invite/');

  await page.getByRole('button', { name: 'Done' }).click();

  return link;
}

test.describe('the spend and approval slice', () => {
  test('a policy written in the builder routes a request to somebody else, who approves it', async ({
    browser,
    page,
  }) => {
    const id = `pw-${randomUUID().slice(0, 8)}`;

    await registerOrganisation(page, id);

    const invitationLink = await inviteFinanceAdmin(page, id);

    /**
     * They accept **before** anything is submitted, and the ordering is not
     * incidental.
     *
     * An invitation is not a membership. A policy naming the finance role while
     * the only finance admin is still an unaccepted invitation resolves to
     * nobody, and submission is refused with UNRESOLVABLE_APPROVER — which is
     * the right answer, arrived at the first time this spec was written the
     * other way round.
     */
    const financeContext = await browser.newContext();
    const finance = await financeContext.newPage();

    await finance.goto(invitationLink);
    await finance.getByRole('textbox', { name: 'Your name', exact: true }).fill('Grace Finance');
    await finance.getByLabel(/Choose a password/).fill(JOINER_PASSWORD);
    await finance.getByRole('button', { name: /Create account and join/ }).click();
    await finance.waitForURL('**/overview');

    // ── the policy, through the rule builder ─────────────────────────────
    await page.goto('/policies');
    await page.getByRole('button', { name: /new policy/i }).click();

    const policyDialog = page.getByRole('dialog');
    await policyDialog
      .getByRole('textbox', { name: 'Name', exact: true })
      .fill(`Over 1,000 needs finance ${id}`);

    // Nothing is ticked by default, and that is the right default: a policy
    // that applied to every kind of spend because nobody chose is a policy
    // whose blast radius nobody decided.
    await policyDialog.getByRole('checkbox', { name: 'Spend request' }).check();

    await policyDialog.getByRole('button', { name: 'Create draft' }).click();

    await page.waitForURL('**/policies/**');

    await page.getByRole('button', { name: 'Add rule' }).click();

    // Every control is populated from the closed field set, so a rule that
    // cannot fire is not expressible here — which is the property being
    // exercised as much as the rule itself.
    await page.getByLabel('Field').first().selectOption('amountInBaseCurrency');
    await page.getByLabel('Operator').first().selectOption('GT');
    await page.getByLabel('Amount').first().fill('1000.00');

    await page.getByLabel('What happens').first().selectOption('REQUIRE_APPROVER');
    await page.getByLabel('Who approves').first().selectOption('ROLE');

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Unsaved')).toBeHidden();

    await page.getByRole('button', { name: 'Publish', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Publish', exact: true }).click();

    // ── the request ──────────────────────────────────────────────────────
    await page.goto('/spend/new');

    await page
      .getByRole('textbox', { name: 'What is this for', exact: true })
      .fill('Design tooling for the new team');
    await page.getByRole('textbox', { name: 'Amount', exact: true }).fill('4200.00');

    // The preview runs the same evaluator the server will, so the requester
    // learns this needs finance *before* submitting rather than after. Its
    // presence is the assertion: a form that only told you afterwards would
    // pass every API test in the repository.
    await expect(page.getByText(/needs approval/i).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole('button', { name: 'Submit', exact: true }).click();
    // A regular expression rather than `**/spend/**`: the form already lives
    // at `/spend/new`, so that glob matches the page it is leaving and waits
    // for nothing at all — which is how a failed submission read as a passing
    // navigation the first time this was written.
    await page.waitForURL(/\/spend\/[0-9a-f-]{8,}/);

    // Awaiting approval, not approved: the policy asked for a human, and the
    // requester is not eligible to be that human.
    await expect(page.getByText('Awaiting approval').first()).toBeVisible({ timeout: 20_000 });

    // ── the approval, in the other session ───────────────────────────────
    try {
      await finance.goto('/approvals');

      // The queue carries enough to decide without opening the request.
      await expect(finance.getByText('Design tooling for the new team')).toBeVisible({
        timeout: 15_000,
      });

      await finance.getByRole('button', { name: 'Approve', exact: true }).first().click();

      // The dialog restates what is being approved — reference, purpose,
      // amount — because the queue row is a summary and approving from a
      // summary is how somebody approves the wrong one.
      const confirmation = finance.getByRole('dialog');
      await expect(
        confirmation.getByRole('heading', { name: 'Approve this request' }),
      ).toBeVisible();

      // Approving asks for no comment. It is agreeing with what was asked, and
      // demanding a sentence for it trains people to type ok — which
      // devalues the field everywhere it matters.
      await confirmation.getByRole('button', { name: 'Approve', exact: true }).click();

      // Gone from the queue, which is the approver's own confirmation that it
      // is done: a queue that still showed it would be one they stop trusting.
      await expect(
        finance.getByRole('paragraph').filter({ hasText: 'Design tooling for the new team' }),
      ).toBeHidden({ timeout: 15_000 });
    } finally {
      await financeContext.close();
    }

    // ── and the requester sees it settled ────────────────────────────────
    await page.reload();
    await expect(page.getByText('Approved').first()).toBeVisible({ timeout: 20_000 });
  });
});
