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

async function registerOrganisation(page: Page, id: string): Promise<void> {
  await page.goto('/register');
  await page.fill('#organizationName', `Budgets ${id}`);
  await page.fill('#fullName', 'Priya Finance');
  await page.fill('#email', `${id}@budgets.test`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/overview');
}

test.describe('budgets and the overview', () => {
  test('a budget is created, activated, allocated, and read back', async ({ page }) => {
    const id = randomUUID().slice(0, 8);

    await registerOrganisation(page, id);

    // The registering member is an ORG_ADMIN, who can see budgets but not
    // manage them — that split is deliberate, and the screen has to reflect it.
    await page.goto('/budgets');
    await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New budget' })).toHaveCount(0);

    // Promote this member to finance, which is who owns budgets.
    await page.goto('/people');
    await page.getByRole('link', { name: 'Priya Finance' }).first().click();
    await page.getByLabel('Role').selectOption('FINANCE_ADMIN');
    await page.getByRole('button', { name: /save/i }).first().click();

    await page.goto('/budgets');
    await page.getByRole('button', { name: 'New budget' }).click();

    await page.getByLabel('What to call it').fill(`Marketing ${id}`);
    await page.getByLabel('Drawn around').selectOption('ORGANIZATION');
    await page.getByLabel('Total to allocate').fill('12000.00');
    await page.getByLabel('Tracked').selectOption('MONTHLY');
    await page.getByRole('button', { name: 'Create it' }).click();

    // Lands on the budget's own page.
    await expect(page.getByRole('heading', { name: `Marketing ${id}` })).toBeVisible();

    // A draft, because a budget created with the wrong scope must not start
    // blocking spend the instant it is saved.
    await expect(page.getByText('Draft')).toBeVisible();

    // Twelve periods, from one total.
    const rows = page.getByRole('row');
    await expect(rows.filter({ hasText: 'January' })).toHaveCount(1);
    await expect(rows.filter({ hasText: 'December' })).toHaveCount(1);

    await page.getByRole('button', { name: 'Activate it' }).click();
    await expect(page.getByText('Active', { exact: true })).toBeVisible();

    // Allocation is absolute: setting January to 2,000 replaces the 1,000 the
    // even split produced rather than adding to it.
    await page.getByRole('button', { name: /Change the allocation for January/ }).click();

    const januaryInput = page.getByLabel(/^Allocation for January/);
    await januaryInput.fill('2000.00');
    await page.getByRole('button', { name: 'Set', exact: true }).click();

    await expect(page.getByText('13,000.00').first()).toBeVisible();
  });

  test('the overview says whose numbers it is showing', async ({ page }) => {
    const id = randomUUID().slice(0, 8);

    await registerOrganisation(page, id);

    await page.goto('/overview');

    // Every figure on this page comes from `/v1/dashboard`; what a browser can
    // check is that they render and that the page is honest about scope.
    await expect(page.getByText('across the organisation')).toBeVisible();
    await expect(page.getByText('Spend this month')).toBeVisible();
    await expect(page.getByText('Waiting on a decision')).toBeVisible();

    // Six points, including the quiet months.
    await expect(page.getByLabel('Monthly spend').getByRole('listitem')).toHaveCount(6);
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
