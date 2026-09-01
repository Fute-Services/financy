import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * The audit screen (task 1.7.9).
 *
 * The API suite proves the endpoints. What only a browser proves here is that
 * an operator can actually get to the answer:
 *
 * - **A filter is a link.** "Everything that touched this record" is pasted
 *   into a ticket, so the state has to live in the URL and survive a reload.
 * - **The cursor is dropped when a filter changes.** A cursor is a position
 *   in one particular query's ordering; carried across a filter change it
 *   points into a result set that no longer exists and the page comes back
 *   empty with nothing to explain it.
 * - **The export downloads a file**, with the attachment disposition the API
 *   set — an audit export rendered inline is a document from an untrusted
 *   source displayed by a trusting viewer.
 * - **The security log shows a failed sign-in**, which has no audit event at
 *   all, because nothing changed.
 */

const PASSWORD = 'correct-horse-battery-staple';

async function registerOrganisation(page: Page): Promise<string> {
  const id = `au-${randomUUID().slice(0, 8)}`;

  await page.goto('/register');
  await page.fill('#organizationName', `Audit ${id}`);
  await page.fill('#fullName', 'Ada Lovelace');
  await page.fill('#email', `${id}@audit-screen.test`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/overview');

  return id;
}

test.describe('the audit screen', () => {
  test('shows what registration recorded, and expands a row to its detail', async ({ page }) => {
    const id = await registerOrganisation(page);

    // Registration's own events carry no before/after — nothing existed
    // before them — so a change is needed to have something to expand.
    await page.goto('/settings/organization');
    await page.getByRole('textbox', { name: 'Name', exact: true }).fill(`Renamed ${id}`);
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Organisation updated.')).toBeVisible();

    await page.goto('/audit');

    // Registration writes its audit events inside its own transaction, so the
    // trail is never empty for an organisation that exists.
    await expect(page.getByRole('table')).toContainText('user.created');

    // The detail is inline rather than in a dialog: reading a trail is
    // comparing an entry with its neighbours, and a modal hides them.
    await page.getByRole('button').filter({ hasText: 'organization.updated' }).first().click();

    await expect(page.getByText('Correlation id')).toBeVisible();
    // The before and after are the fields that moved, and only those.
    await expect(page.getByText('Before')).toBeVisible();
    await expect(page.locator('pre').first()).toContainText('name');
  });

  test('keeps a filter in the URL, so a filtered view is a link', async ({ page }) => {
    await registerOrganisation(page);

    await page.goto('/audit');
    await page.getByLabel('Resource').selectOption('membership');

    await expect(page).toHaveURL(/resourceType=membership/);

    // The link survives a reload, which is the whole point of putting it in
    // the URL rather than in component state.
    await page.reload();
    await expect(page.getByLabel('Resource')).toHaveValue('membership');
    await expect(page.getByRole('table')).toContainText('membership.created');
    await expect(page.getByRole('table')).not.toContainText('user.created');
  });

  test('recovers from a stale cursor rather than crashing', async ({ page }) => {
    await registerOrganisation(page);

    // A cursor reaches this page from a bookmark or a pasted link, and one
    // the API will not accept must not take the screen down with it.
    await page.goto('/audit?cursor=Zm9v');

    await expect(page.getByText(/no longer has/i)).toBeVisible();
    await expect(page.getByRole('table')).toContainText('user.created');
  });

  test('drops the cursor when a filter changes', async ({ page }) => {
    await registerOrganisation(page);

    await page.goto('/audit?cursor=Zm9v');

    await page.getByLabel('Resource').selectOption('entity');

    // Gone. Carried across a filter change it would point into a result set
    // that no longer exists, and the page would come back empty.
    await expect(page).not.toHaveURL(/cursor=/);
    await expect(page).toHaveURL(/resourceType=entity/);
  });

  test('downloads the export as a file, not a page', async ({ page }) => {
    await registerOrganisation(page);

    await page.goto('/audit');

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Export CSV' }).click(),
    ]);

    // The filename comes from the API's `Content-Disposition`. Rendering it
    // inline would be a document from an untrusted source displayed by a
    // trusting viewer.
    expect(download.suggestedFilename()).toMatch(/^audit-\d{4}-\d{2}-\d{2}\.csv$/);
  });

  test('shows a failed sign-in in the security log, which the audit trail cannot', async ({
    page,
    context,
  }) => {
    const id = await registerOrganisation(page);

    // A wrong password in a separate context, so the signed-in session here
    // is untouched.
    const stranger = await context.browser()?.newContext();
    if (stranger === undefined) throw new Error('no browser context');

    const strangerPage = await stranger.newPage();
    await strangerPage.goto('/login');
    await strangerPage.fill('#email', `${id}@audit-screen.test`);
    await strangerPage.fill('#password', 'not-the-password');

    // Waiting for the 401 itself rather than for the alert. The alert only
    // says the browser rendered something; the response says the attempt
    // reached the API and its security event has committed — which is what
    // the next assertion is about. Under load the two are far enough apart to
    // matter, and this spec failed exactly that way in a full run.
    const [refusal] = await Promise.all([
      strangerPage.waitForResponse(
        (response) =>
          response.url().includes('/api/auth/login') && response.request().method() === 'POST',
      ),
      strangerPage.click('button[type=submit]'),
    ]);

    expect(refusal.status()).toBe(401);
    await stranger.close();

    await page.goto('/audit?view=security');

    // Nothing changed, so there is no audit event — which is exactly why the
    // security log exists as a separate collection.
    await expect(page.getByRole('table')).toContainText('Failed sign-in');

    // And the export button is gone: there is no security-log export, and
    // offering one that 404s would be worse than not offering it.
    await expect(page.getByRole('link', { name: 'Export CSV' })).toHaveCount(0);
  });
});
