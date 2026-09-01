import { randomUUID } from 'node:crypto';

import { expect, test, type Locator, type Page } from '@playwright/test';

/**
 * The people screen's writes, in a real browser (task 1.7.7).
 *
 * This is the screen where a mistake is a privilege escalation rather than a
 * typo, so the properties worth a browser test are the refusals:
 *
 * - **Step-up is asked for, and a wrong password stops the change.** The role
 *   dialog posts the password and the new role in one submission; if the
 *   password is wrong the step-up fails and the role change never runs. A
 *   failed password must not leave a partly applied privilege change behind.
 * - **The caller's own row offers nothing.** The API refuses a self role
 *   change and a self deactivation, so a control there would only ever
 *   produce a 403.
 * - **Deactivation signs the person out.** Not just a status change — the
 *   sessions behind the account are revoked, and the browser can show that by
 *   watching a second context stop working.
 */

const PASSWORD = 'correct-horse-battery-staple';
const JOINER_PASSWORD = 'another-correct-horse-staple';

function textbox(scope: Page | Locator, name: string): Locator {
  return scope.getByRole('textbox', { name, exact: true });
}

function dialog(page: Page): Locator {
  return page.getByRole('dialog');
}

async function registerOrganisation(page: Page): Promise<string> {
  const id = `pw-${randomUUID().slice(0, 8)}`;

  await page.goto('/register');
  await page.fill('#organizationName', `People ${id}`);
  await page.fill('#fullName', 'Ada Lovelace');
  await page.fill('#email', `${id}@people.test`);
  await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForURL('**/overview');

  return id;
}

test.describe('people writes', () => {
  test('invites someone, previewing what the role grants', async ({ page }) => {
    const id = await registerOrganisation(page);

    await page.goto('/people');
    await page.getByRole('button', { name: 'Invite someone' }).click();

    await dialog(page)
      .getByRole('textbox', { name: 'Email', exact: true })
      .fill(`preview-${id}@people.test`);

    // Choosing a role is choosing what somebody may do to the organisation's
    // money. A select showing five names says nothing about the difference,
    // so the dialog resolves the grants from the same catalogue the server's
    // guard reads.
    await dialog(page).getByRole('combobox', { name: 'Role', exact: true }).selectOption('MANAGER');
    await expect(dialog(page)).toContainText('approval:act');

    await dialog(page)
      .getByRole('combobox', { name: 'Role', exact: true })
      .selectOption('EMPLOYEE');
    await expect(dialog(page)).not.toContainText('approval:act');

    await page.getByRole('button', { name: 'Send invitation' }).click();

    await expect(dialog(page)).toBeHidden();
    await expect(page.getByText(`preview-${id}@people.test`)).toBeVisible();
  });

  test('offers nothing on the caller’s own row', async ({ page }) => {
    await registerOrganisation(page);

    await page.goto('/people');

    const ownRow = page.getByRole('row').filter({ hasText: 'Ada Lovelace' });

    // "You", not a disabled button: a control that exists and never works is
    // worse than one that does not.
    await expect(ownRow).toContainText('You');
    await expect(ownRow.getByRole('button', { name: 'Change role' })).toHaveCount(0);
    await expect(ownRow.getByRole('button', { name: 'Deactivate' })).toHaveCount(0);
  });

  test('changes a colleague’s role once the password is confirmed', async ({ page, request }) => {
    const id = await registerOrganisation(page);
    const email = `colleague-${id}@people.test`;

    // Invite through the screen, accept through the API — acceptance is a
    // signed-out flow with its own spec, and duplicating it here would test
    // the same thing twice while making this spec about two subjects.
    await page.goto('/people');
    await page.getByRole('button', { name: 'Invite someone' }).click();
    await dialog(page).getByRole('textbox', { name: 'Email', exact: true }).fill(email);
    await dialog(page)
      .getByRole('combobox', { name: 'Role', exact: true })
      .selectOption('EMPLOYEE');
    await page.getByRole('button', { name: 'Send invitation' }).click();
    await expect(dialog(page)).toBeHidden();

    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

    const issued = await request.post('http://localhost:4100/v1/memberships/invitations', {
      headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
      data: { email: `second-${email}`, roleKey: 'EMPLOYEE' },
    });
    const token = ((await issued.json()) as { data: { token: string } }).data.token;

    await request.post('http://localhost:4100/v1/auth/invitations/accept', {
      headers: { 'Content-Type': 'application/json' },
      data: { token, fullName: 'Grace Hopper', password: JOINER_PASSWORD },
    });

    await page.goto('/people');

    const row = page.getByRole('row').filter({ hasText: 'Grace Hopper' });
    await expect(row).toContainText('Employee');

    await row.getByRole('button', { name: 'Change role' }).click();

    await dialog(page)
      .getByRole('combobox', { name: 'New role', exact: true })
      .selectOption('MANAGER');
    await textbox(dialog(page), 'Why').fill('Taking over the platform team');

    // The wrong password first. The step-up fails, so the role change never
    // runs — a failed password must not leave a partly applied privilege
    // change behind.
    await dialog(page)
      .getByLabel(/Confirm your password/)
      .fill('not-my-password');
    await page.getByRole('button', { name: 'Change role' }).last().click();

    // Waiting for the *refusal*, not merely for the dialog to still be there:
    // the dialog was already visible before the click, so asserting on it
    // would pass while the request was still in flight and the next fill
    // would race the form reset React performs when an action settles.
    await expect(dialog(page).getByRole('alert')).toContainText(/password is incorrect/i);
    await expect(page.getByRole('row').filter({ hasText: 'Grace Hopper' })).toContainText(
      'Employee',
    );

    // Re-filled from scratch. React resets an uncontrolled form once its
    // action settles, so the values from the failed attempt are gone.
    await dialog(page)
      .getByRole('combobox', { name: 'New role', exact: true })
      .selectOption('MANAGER');
    await textbox(dialog(page), 'Why').fill('Taking over the platform team');
    await dialog(page)
      .getByLabel(/Confirm your password/)
      .fill(PASSWORD);
    await page.getByRole('button', { name: 'Change role' }).last().click();

    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: 'Grace Hopper' })).toContainText(
      'Manager',
    );
  });

  test('deactivates a colleague and signs them out everywhere', async ({ page, request }) => {
    const id = await registerOrganisation(page);

    const cookies = await page.context().cookies();
    const cookieHeader = cookies.map((cookie) => `${cookie.name}=${cookie.value}`).join('; ');

    const issued = await request.post('http://localhost:4100/v1/memberships/invitations', {
      headers: { Cookie: cookieHeader, 'Content-Type': 'application/json' },
      data: { email: `leaver-${id}@people.test`, roleKey: 'EMPLOYEE' },
    });
    const token = ((await issued.json()) as { data: { token: string } }).data.token;

    const accepted = await request.post('http://localhost:4100/v1/auth/invitations/accept', {
      headers: { 'Content-Type': 'application/json' },
      data: { token, fullName: 'Katherine Johnson', password: JOINER_PASSWORD },
    });

    // Their session, captured before the deactivation.
    const setCookie = accepted.headers()['set-cookie'] ?? '';
    const theirCookie = setCookie.split(';')[0] ?? '';

    await expect(
      await request.get('http://localhost:4100/v1/auth/session', {
        headers: { Cookie: theirCookie },
      }),
    ).toBeOK();

    await page.goto('/people');

    const row = page.getByRole('row').filter({ hasText: 'Katherine Johnson' });
    await row.getByRole('button', { name: 'Deactivate' }).click();

    await textbox(dialog(page), 'Why').fill('Left the company');
    await page.getByRole('button', { name: 'Deactivate' }).last().click();

    await expect(dialog(page)).toBeHidden();
    await expect(page.getByRole('row').filter({ hasText: 'Katherine Johnson' })).toContainText(
      'Deactivated',
    );

    // The part that matters. A deactivation that left live sessions working
    // would report success while the person kept full access until their
    // token happened to expire.
    const after = await request.get('http://localhost:4100/v1/auth/session', {
      headers: { Cookie: theirCookie },
    });
    expect(after.status()).toBe(401);
  });
});
