import { randomUUID } from 'node:crypto';

import { expect, test, type Page } from '@playwright/test';

/**
 * The authentication journey, in a real browser against the real stack
 * (docs/16 §8).
 *
 * The Supertest suite in `apps/api` already proves the API's behaviour. What
 * only a browser can prove is the part between them: that the `httpOnly`
 * cookie set by the API survives the Next proxy, that the server-rendered
 * shell sees the session, and that signing out actually ends it rather than
 * merely navigating away.
 *
 * Each test registers its own organisation. Sharing one would make the suite
 * order-dependent, and an auth suite that passes only in one order is not
 * telling you anything.
 */

const PASSWORD = 'correct-horse-battery-staple';

function unique(prefix: string): string {
  // `randomUUID` rather than `Math.random`, which lint bans everywhere —
  // including here, because a rule with test-shaped holes in it stops being a
  // rule people trust.
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

async function registerOrganisation(page: Page): Promise<string> {
  const id = unique('e2e');

  await page.goto('/register');
  await page.fill('#organizationName', `E2E ${id}`);
  await page.fill('#fullName', 'Ada Lovelace');
  await page.fill('#email', `${id}@e2e.test`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/overview');

  return `${id}@e2e.test`;
}

test.describe('authentication', () => {
  test('an unauthenticated visitor is sent to sign in', async ({ page }) => {
    await page.goto('/overview');

    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
  });

  test('registering creates an organisation and lands in the app', async ({ page }) => {
    const id = unique('signup');

    await page.goto('/register');
    await page.fill('#organizationName', `Signup ${id}`);
    await page.fill('#fullName', 'Ada Lovelace');
    await page.fill('#email', `${id}@e2e.test`);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');

    // An explicit timeout, unlike every other assertion in this file. The
    // default five seconds is for something appearing on a page that has
    // already loaded; this waits on registration's whole transaction reaching
    // a remote database, which takes about three seconds by itself.
    await expect(page).toHaveURL(/\/overview$/, { timeout: 30_000 });
    // The name comes back from the database, not from the form state.
    await expect(page.locator('nav')).toContainText(`Signup ${id}`.slice(0, 12));
  });

  test('a weak password is rejected with the rule beside the field', async ({ page }) => {
    await page.goto('/register');
    await page.fill('#organizationName', 'Weak Co');
    await page.fill('#fullName', 'Ada');
    await page.fill('#email', `${unique('weak')}@e2e.test`);
    await page.fill('#password', 'short');
    await page.click('button[type=submit]');

    await expect(page.locator('#password-error')).toContainText('12 characters');
    await expect(page).toHaveURL(/\/register$/);
  });

  test('signing in works, and the session survives a reload', async ({ page }) => {
    const email = await registerOrganisation(page);

    // Sign out so the next sign-in is a real one rather than a redirect.
    await page.click('nav button');
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.waitForURL('**/login');

    await page.fill('#email', email);
    await page.fill('#password', PASSWORD);
    await page.click('button[type=submit]');
    await expect(page).toHaveURL(/\/overview$/);

    // The shell renders from a server-side session read, so a reload proves
    // the cookie is doing the work rather than in-memory state.
    await page.reload();
    await expect(page).toHaveURL(/\/overview$/);
  });

  /**
   * The message must not distinguish a wrong password from an unknown account.
   * A friendlier one here would undo the defence the API is careful about.
   */
  test('a bad sign-in says only that the pair is wrong', async ({ page }) => {
    await page.goto('/login');
    await page.fill('#email', `${unique('nobody')}@e2e.test`);
    await page.fill('#password', 'definitely-not-the-password');
    await page.click('button[type=submit]');

    // Scoped to the form: Next renders its own `role="alert"` route announcer,
    // so an unscoped lookup matches two elements and fails on the empty one.
    await expect(page.locator('form [role=alert]')).toHaveText('Email or password is incorrect.');
    await expect(page).toHaveURL(/\/login$/);
  });

  /**
   * The property that a cleared cookie alone would not give: the session is
   * revoked server-side, so navigating back with the same browser state does
   * not get back in.
   */
  test('signing out ends the session, not just the navigation', async ({ page }) => {
    await registerOrganisation(page);

    await page.click('nav button');
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login$/);

    await page.goto('/overview');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('the command palette opens on ⌘K and navigates', async ({ page }) => {
    await registerOrganisation(page);

    // The shortcut is bound in an effect, so it does nothing until the shell
    // hydrates. Waiting for the trigger is what proves that has happened —
    // pressing the key first passed about four runs in five, which is the
    // worst possible failure rate for a test.
    await expect(page.getByRole('button', { name: /Jump to/ })).toBeVisible();

    await page.keyboard.press('ControlOrMeta+k');

    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();

    // Wait for the input to take focus before typing. The palette autofocuses
    // in an effect, and filling before that races the focus.
    const search = page.getByLabel('Search navigation');
    await expect(search).toBeFocused();

    // Subsequence matching: four letters, none of them a prefix.
    await search.fill('aprv');

    /**
     * Wait for the list to have filtered before pressing Enter.
     *
     * Typing and pressing immediately races the re-render: the key lands while
     * the highlighted index still points into the unfiltered list, and Enter
     * navigates to whatever was there — or to nothing. It passed alone and
     * failed about one run in three under two workers, which is the shape of
     * flake that gets a test deleted rather than fixed.
     */
    // The highlighted row *is* the precondition for Enter, so it is what to
    // wait for — asserting a result count would hard-code today's navigation
    // (`aprv` also matches "Policies") and break the day somebody adds a
    // module.
    await expect(palette.locator('button[data-highlighted="true"]')).toHaveText(/Approvals/);

    await page.keyboard.press('Enter');

    await expect(page).toHaveURL(/\/approvals$/);
  });
});
