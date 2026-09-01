import { randomUUID } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The settings writes, in a real browser (task 1.7.8).
 *
 * The API suite already proves the endpoints. What only a browser can prove is
 * that the *form* carries the version it was rendered with, that a refusal
 * reaches the person who caused it, and that the table they were looking at
 * shows the new value afterwards rather than a cached render of the old one.
 *
 * That last one is the failure this suite exists for. Next caches server
 * components aggressively: without `revalidatePath`, a save succeeds, the API
 * holds the new value, and the screen still shows the old one — which reads to
 * the user as "it didn't work" and to a developer as "it works fine".
 *
 * Fields are selected by accessible name and scoped to the form or dialog
 * they belong to. Both matter: the settings screen holds three forms with a
 * field called "Name", and an unscoped selector matches all three the moment
 * a dialog opens.
 */

const PASSWORD = 'correct-horse-battery-staple';

async function registerOrganisation(page: Page): Promise<string> {
  const id = `sw-${randomUUID().slice(0, 8)}`;

  await page.goto('/register');
  await page.fill('#organizationName', `Settings ${id}`);
  await page.fill('#fullName', 'Ada Lovelace');
  await page.fill('#email', `${id}@settings.test`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/overview');

  return id;
}

/**
 * Fields are found by **accessible name**, not by `getByLabel`.
 *
 * `getByLabel` matches the label's text content, which for a required field
 * includes the `*` — so `getByLabel('Name', { exact: true })` finds nothing
 * while the field is plainly labelled "Name". The asterisk is `aria-hidden`,
 * so the accessible name is "Name" and `getByRole` sees what a screen reader
 * sees. That is the name worth asserting on: it is the one the person using
 * assistive technology actually hears.
 */
function textbox(scope: Page | Locator, name: string): Locator {
  return scope.getByRole('textbox', { name, exact: true });
}

/**
 * The organisation form's own "Name" box.
 *
 * No dialog is open in the specs that use this, so the page scope is
 * unambiguous — and when one is, the dialog helpers below scope to it. Three
 * forms on this screen have a field called "Name".
 */
function organisationName(page: Page): Locator {
  return textbox(page, 'Name');
}

function dialogField(page: Page, name: string): Locator {
  return textbox(page.getByRole('dialog'), name);
}

function dialogSelect(page: Page, name: string): Locator {
  return page.getByRole('dialog').getByRole('combobox', { name, exact: true });
}

test.describe('settings writes', () => {
  test('renames the organisation and shows the new name straight away', async ({ page }) => {
    const id = await registerOrganisation(page);

    await page.goto('/settings/organization');

    await expect(organisationName(page)).toHaveValue(`Settings ${id}`);

    await organisationName(page).fill(`Renamed ${id}`);
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText('Organisation updated.')).toBeVisible();

    // The proof that `revalidatePath` ran. Without it the input re-renders
    // from the cached server render and still holds the old name, while the
    // API holds the new one.
    await page.reload();
    await expect(organisationName(page)).toHaveValue(`Renamed ${id}`);
  });

  test('refuses a second save from a stale version and offers a reload', async ({
    page,
    context,
  }) => {
    const id = await registerOrganisation(page);

    await page.goto('/settings/organization');

    // A second tab sharing the session — which is exactly the situation the
    // whole precondition exists for: two administrators, one form, both open.
    const other = await context.newPage();
    await other.goto('/settings/organization');
    await organisationName(other).fill(`First writer ${id}`);
    await other.getByRole('button', { name: 'Save changes' }).click();
    await expect(other.getByText('Organisation updated.')).toBeVisible();
    await other.close();

    // The first tab still holds the version it rendered with.
    await organisationName(page).fill(`Second writer ${id}`);
    await page.getByRole('button', { name: 'Save changes' }).click();

    await expect(page.getByText(/someone else changed this/i)).toBeVisible();
    // A reload, not a retry: retrying with the same stale version fails
    // identically, and the person needs to see what changed first.
    await expect(page.getByRole('button', { name: 'Reload' })).toBeVisible();

    // And the first writer's value survived — the refusal is not cosmetic.
    await page.reload();
    await expect(organisationName(page)).toHaveValue(`First writer ${id}`);
  });

  test('creates an entity and lists it', async ({ page }) => {
    const id = await registerOrganisation(page);

    await page.goto('/settings/organization');
    await page.getByRole('button', { name: 'Add entity' }).click();

    await dialogField(page, 'Name').fill(`Branch ${id}`);
    await dialogField(page, 'Country').fill('gb');
    await dialogField(page, 'Functional currency').fill('gbp');
    await page.getByRole('button', { name: 'Create entity' }).click();

    // The dialog closes on success and the row appears — both of which need
    // the revalidate to have happened.
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: `Branch ${id}` })).toContainText('GBP');
  });

  test('refuses to archive the only entity, and says why', async ({ page }) => {
    await registerOrganisation(page);

    await page.goto('/settings/organization');

    // Registration creates exactly one entity, so this is the last one.
    await page.getByRole('button', { name: 'Archive' }).first().click();

    await expect(page.getByText(/must keep at least one active entity/i)).toBeVisible();
  });

  test('builds a department tree and indents it by depth', async ({ page }) => {
    const id = await registerOrganisation(page);

    await page.goto('/settings/organization');

    await page.getByRole('button', { name: 'Add department' }).click();
    await dialogField(page, 'Name').fill(`Engineering ${id}`);
    await page.getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: 'Add department' }).click();
    await dialogField(page, 'Name').fill(`Platform ${id}`);
    // The parent select offers every legal destination, which is also the only
    // place the cycle rule can be explained before it is hit rather than after.
    await dialogSelect(page, 'Reports into').selectOption({ label: `Engineering ${id}` });
    await page.getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    const child = page.getByText(`Platform ${id}`, { exact: true });
    await expect(child).toBeVisible();

    // Indented, because the API derives `depth` from the same materialised
    // path it sorted by — so the indent and the hierarchy cannot disagree.
    await expect(child).toHaveCSS('padding-left', '20px');
  });

  test('refuses to archive a department that still has children', async ({ page }) => {
    const id = await registerOrganisation(page);

    await page.goto('/settings/organization');

    await page.getByRole('button', { name: 'Add department' }).click();
    await dialogField(page, 'Name').fill(`Parent ${id}`);
    await page.getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    await page.getByRole('button', { name: 'Add department' }).click();
    await dialogField(page, 'Name').fill(`Child ${id}`);
    await dialogSelect(page, 'Reports into').selectOption({ label: `Parent ${id}` });
    await page.getByRole('button', { name: 'Create department' }).click();
    await expect(page.getByRole('dialog')).toBeHidden();

    // The parent's own archive button. Cascading would archive rows nobody
    // asked about, so the API refuses and names what is in the way.
    await page
      .getByRole('row')
      .filter({ hasText: `Parent ${id}` })
      .getByRole('button', { name: 'Archive' })
      .click();

    await expect(page.getByText(/still has sub-departments/i)).toBeVisible();
  });
});
