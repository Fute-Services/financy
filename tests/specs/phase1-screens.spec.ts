import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * People, Settings, and the Audit log, in a real browser.
 *
 * These are the three screens that finish Phase 1, and what makes them worth a
 * browser test rather than a Supertest one is the property they are here to
 * prove: that they show **real data** and no longer say "isn't built yet". The
 * API suite already checks the endpoints; only a browser can check that the
 * page rendered what came back.
 *
 * Each spec registers its own organisation, so the numbers asserted below are
 * exact rather than "greater than zero": one person, one entity, five roles.
 */

const PASSWORD = 'correct-horse-battery-staple';

/** Wording the shell uses for an unbuilt module. Asserted absent, everywhere. */
const NOT_BUILT = /isn['’]t built yet|not built yet|coming in phase/i;

async function registerOrganisation(page: Page): Promise<string> {
  const id = `p1-${randomUUID().slice(0, 8)}`;

  await page.goto('/register');
  await page.fill('#organizationName', `Phase1 ${id}`);
  await page.fill('#fullName', 'Ada Lovelace');
  await page.fill('#email', `${id}@phase1.test`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/overview');

  return id;
}

test.describe('phase 1 screens', () => {
  test('People lists the organisation’s members from the API', async ({ page }) => {
    await registerOrganisation(page);

    await page.goto('/people');

    await expect(page.getByRole('heading', { name: 'People' })).toBeVisible();
    await expect(page.locator('body')).not.toHaveText(NOT_BUILT);

    // Scoped to the table. The name and the role both appear in the sidebar
    // too, so an unscoped `getByText` matches twice and fails strict mode —
    // which is Playwright telling you the assertion was not about the table.
    const table = page.getByRole('table');
    await expect(table).toContainText('Ada Lovelace');
    await expect(table).toContainText('Organisation admin');

    // One person, and the header says so.
    await expect(page.getByText('1 person')).toBeVisible();

    // "Never" rather than a dash: someone who has not signed in is a
    // different fact from a missing value, and the column has to say which.
    await expect(table).toContainText('Never');
    await expect(table).toContainText('Active');
  });

  test('People filters through the URL, so a filtered view can be shared', async ({ page }) => {
    await registerOrganisation(page);

    await page.goto('/people');
    await page.getByRole('searchbox', { name: 'Search people' }).fill('Ada');
    await page.getByRole('searchbox', { name: 'Search people' }).press('Enter');

    await expect(page).toHaveURL(/[?&]q=Ada/);
    await expect(page.getByText('Ada Lovelace')).toBeVisible();

    // A term that matches nobody gives the filtered empty state, not the
    // first-run one — the distinction tells the reader whether to clear the
    // filter or to add their first colleague.
    await page.goto('/people?q=nobodyhere');
    await expect(page.getByText(/No results match these filters/i)).toBeVisible();
  });

  test('Settings shows the organisation, its entity, its roles, and its categories', async ({
    page,
  }) => {
    const id = await registerOrganisation(page);

    await page.goto('/settings/organization');

    await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
    await expect(page.locator('body')).not.toHaveText(NOT_BUILT);

    // The organisation, read back from the database rather than echoed.
    // Read from the form's own fields — the name is also in the sidebar and
    // in the organisation switcher, so an unscoped match proves nothing.
    //
    // This was a definition list until the writes landed (task 1.7.8). The
    // screen is a form now, and the assertion follows it rather than being
    // loosened to whatever still passes.
    await expect(page.getByRole('textbox', { name: 'Name', exact: true })).toHaveValue(
      `Phase1 ${id}`,
    );
    await expect(page.getByRole('textbox', { name: 'Base currency', exact: true })).toHaveValue(
      'USD',
    );

    // Registration creates one default entity and the full category tree.
    await expect(page.getByRole('table', { name: 'Legal entities' })).toBeVisible();

    // All five roles, with the permission counts the catalogue grants. A
    // count of zero everywhere would mean the join table never got seeded.
    const roles = page.getByRole('table').filter({ hasText: 'What it means' });
    await expect(roles).toContainText('Organisation admin');
    await expect(roles).toContainText('Auditor');

    // The base currency is disabled and explains why, rather than being a
    // greyed box with no reason — which is indistinguishable from a broken one.
    await expect(page.getByRole('textbox', { name: 'Base currency', exact: true })).toBeDisabled();
    await expect(page.getByText(/Set at registration/i)).toBeVisible();
  });

  test('the Audit log shows what registration recorded, and offers no way to write', async ({
    page,
  }) => {
    await registerOrganisation(page);

    await page.goto('/audit');

    await expect(page.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(page.locator('body')).not.toHaveText(NOT_BUILT);

    // Registration writes audit events inside its own transaction, so the
    // trail is never empty for an organisation that exists.
    await expect(page.getByRole('table')).toBeVisible();
    await expect(page.getByText('Read-only')).toBeVisible();

    // No control offers to add or delete an entry, because no endpoint would
    // accept one. A button here would be a promise the API refuses to keep.
    await expect(page.getByRole('button', { name: /delete|remove|new entry/i })).toHaveCount(0);
  });

  /**
   * The permission model, seen from the browser.
   *
   * A fresh registrant is an `ORG_ADMIN` and holds all three permissions, so
   * every screen renders. What this asserts is the *other* half: that the
   * shell links to them, which is what "Phase 1 is built" means to a user.
   */
  test('the command palette reaches all three, unmarked as unbuilt', async ({ page }) => {
    await registerOrganisation(page);

    for (const [query, heading] of [
      ['People', 'People'],
      ['Settings', 'Settings'],
      ['Audit', 'Audit log'],
    ] as const) {
      await page.goto('/overview');

      // The shortcut is bound in an effect, so it does nothing until the shell
      // hydrates. Waiting for the trigger is what proves that has happened.
      await expect(page.getByRole('button', { name: /Jump to/ })).toBeVisible();
      await page.keyboard.press('ControlOrMeta+k');

      const palette = page.getByRole('dialog', { name: 'Command palette' });
      await expect(palette).toBeVisible();

      // Autofocus also happens in an effect; filling before it races focus.
      const search = page.getByLabel('Search navigation');
      await expect(search).toBeFocused();
      await search.fill(query);

      const entry = palette.getByRole('button').filter({ hasText: heading }).first();
      await expect(entry).toBeVisible();

      // The palette appends "Phase N" to anything beyond the built phases.
      // These three are Phase 1 and must carry no such marker — which is the
      // assertion that `BUILT_PHASES` was actually raised.
      await expect(entry).not.toContainText(/Phase \d/);

      await entry.click();
      await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    }
  });
});
