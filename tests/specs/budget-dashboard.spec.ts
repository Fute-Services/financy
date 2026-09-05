import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * Budgets and the overview, in a browser (Epic 4.6).
 *
 * ## What only this level can prove
 *
 * The API suite already asserts that a budget's arithmetic is right and that
 * fifty concurrent commitments converge. What it cannot see is whether a person
 * can get from an empty organisation to a live budget and read its position —
 * and the failures that live in that seam all pass every cheaper test:
 *
 * - a budget created as a draft that nothing ever offers to activate,
 * - an allocation form that sends a delta where the API expects an absolute,
 * - an overview whose figures come from a different query than the budget page,
 * - a meter that renders without the number beside it.
 *
 * ## One scenario, not six
 *
 * The overspend behaviours, the threshold alerts, and the currency exclusion
 * are asserted in the API suite, where each takes three lines and can be
 * checked precisely. What a browser is uniquely qualified to say is that the
 * screens are reachable, that they agree with one another, and that the
 * numbers on them are the server's.
 */

const PASSWORD = 'correct-horse-battery-staple';
const JOINER_PASSWORD = 'another-correct-horse-staple';

async function registerOrganisation(page: Page, id: string): Promise<void> {
  await page.goto('/register');
  await page.fill('#organizationName', `Budgets ${id}`);
  await page.fill('#fullName', 'Priya Founder');
  await page.fill('#email', `${id}@budgets.test`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/overview');
}

/**
 * Invite a finance admin and hand back the one-time link.
 *
 * The founder cannot simply promote themselves: the API refuses a self role
 * change, and the people table shows "You" where the control would otherwise
 * be. That is separation of duties working, not a gap — so the only route to
 * a budget in a new organisation is to bring somebody in, and a spec that
 * asserts budgets has to walk it.
 */
async function inviteFinanceAdmin(page: Page, id: string): Promise<string> {
  await page.goto('/people');
  await page.getByRole('button', { name: 'Invite someone' }).click();

  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill(`finance-${id}@budgets.test`);
  await dialog.getByRole('combobox', { name: 'Role', exact: true }).selectOption('FINANCE_ADMIN');
  await page.getByRole('button', { name: 'Send invitation' }).click();

  // The token is in this response and nowhere else — it is stored hashed.
  const link = await dialog.getByRole('textbox', { name: 'Send them this link' }).inputValue();
  expect(link, 'the invite dialog should surface a one-time link').toContain('/invite/');

  await page.getByRole('button', { name: 'Done' }).click();

  return link;
}

test.describe('budgets and the overview', () => {
  test('a budget is created, activated, allocated, and read back', async ({ browser, page }) => {
    const id = randomUUID().slice(0, 8);

    await registerOrganisation(page, id);

    // The registering member is an ORG_ADMIN, who can see budgets but not
    // manage them — that split is deliberate, and the screen has to reflect it.
    await page.goto('/budgets');
    // `exact`, because the empty state's own heading ("No budgets yet")
    // also contains the word and a substring match resolves to both.
    await expect(page.getByRole('heading', { name: 'Budgets', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New budget' })).toHaveCount(0);

    // Budgets belong to finance, so bring a finance admin in. A separate
    // browser context, because they are a different person and sharing the
    // founder's cookie jar would prove nothing about who may do this.
    const invitationLink = await inviteFinanceAdmin(page, id);

    const financeContext = await browser.newContext();
    const finance = await financeContext.newPage();

    await finance.goto(invitationLink);
    await finance.getByRole('textbox', { name: 'Your name', exact: true }).fill('Grace Finance');
    await finance.getByLabel(/Choose a password/).fill(JOINER_PASSWORD);
    await finance.getByRole('button', { name: /Create account and join/ }).click();
    await finance.waitForURL('**/overview');

    await finance.goto('/budgets');
    await finance.getByRole('button', { name: 'New budget' }).click();

    // Scoped to the dialog: the list behind it has its own "Drawn around"
    // filter with the same label, so an unscoped lookup matches both.
    const createBudget = finance.getByRole('dialog', { name: 'Create a budget' });
    await createBudget.getByLabel('What to call it').fill(`Marketing ${id}`);
    await createBudget.getByLabel('Drawn around').selectOption('ORGANIZATION');
    await createBudget.getByLabel('Total to allocate').fill('12000.00');
    await createBudget.getByLabel('Tracked').selectOption('MONTHLY');
    await createBudget.getByRole('button', { name: 'Create it' }).click();

    // Open it from the list rather than relying on the redirect that follows
    // creation: `revalidatePath` re-renders `/budgets` underneath that push,
    // so which one wins is a race, and the link is the route every budget has.
    await finance.getByRole('link', { name: `Marketing ${id}` }).click();
    await finance.waitForURL('**/budgets/**');

    await expect(finance.getByRole('heading', { name: `Marketing ${id}` })).toBeVisible();

    // A draft, because a budget created with the wrong scope must not start
    // blocking spend the instant it is saved.
    await expect(finance.getByText('Draft')).toBeVisible();

    // Twelve periods, from one total.
    const rows = finance.getByRole('row');
    await expect(rows.filter({ hasText: 'January' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'December' })).toHaveCount(1);

    await finance.getByRole('button', { name: 'Activate it' }).click();
    await expect(finance.getByText('Active', { exact: true })).toBeVisible();

    // Allocation is absolute: setting January to 2,000 replaces the 1,000 the
    // even split produced rather than adding to it.
    await finance.getByRole('button', { name: /Change the allocation for January/ }).click();

    const januaryInput = finance.getByLabel(/^Allocation for January/);
    await januaryInput.fill('2000.00');
    await finance.getByRole('button', { name: 'Set', exact: true }).click();

    await expect(finance.getByText('13,000.00').first()).toBeVisible();

    await financeContext.close();
  });

  test('the overview says whose numbers it is showing', async ({ page }) => {
    const id = randomUUID().slice(0, 8);

    await registerOrganisation(page, id);

    await page.goto('/overview');

    // Every figure on this page comes from `/v1/dashboard`; what a browser can
    // check is that they render and that the page is honest about scope.
    await expect(page.getByText('across the organisation')).toBeVisible();
    await expect(page.getByText('Spend this month')).toBeVisible();
    // The tile's label, not its hint: the hint reads "Nothing is stuck" until
    // something is actually queued, so asserting on it tests the fixture
    // rather than the screen.
    await expect(page.getByText('Awaiting approval')).toBeVisible();

    // Six points, including the quiet months. The bars themselves are
    // `aria-hidden` decoration; the chart's real content is the screen-reader
    // table in its caption, so that is what a browser should be asserting on.
    await expect(
      page
        .getByRole('table', { name: 'Spend by month, across the last six months' })
        .locator('tbody tr'),
    ).toHaveCount(6);
  });

  test('the report gallery leads to a report with its own totals', async ({ page }) => {
    const id = randomUUID().slice(0, 8);

    await registerOrganisation(page, id);

    await page.goto('/reports');
    await expect(page.getByText('Which teams are spending?')).toBeVisible();

    await page.getByText('How much did we spend, and how does it compare with before?').click();

    await expect(page.getByRole('heading', { name: 'Total spend' })).toBeVisible();
    // An empty organisation is an empty report, and it says so rather than
    // rendering a zero that looks like data.
    await expect(page.getByText('Nothing matched')).toBeVisible();
  });
});
