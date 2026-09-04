import { expect, test } from '@playwright/test';

/**
 * The demo request on the public site.
 *
 * The one form a signed-out visitor can submit, and for a long time the one
 * button in the product that did nothing: it sat on a `<form>` with no
 * `action`, so clicking it triggered a browser GET, reloaded the page, and
 * discarded everything typed — with no error to show for it. These assertions
 * exist so that cannot come back silently.
 *
 * ## Why serial, and why only two submissions
 *
 * `POST /v1/leads` allows three per hour **per IP address**, and every worker
 * on this machine shares one. Two submissions is the budget: one refused, one
 * accepted. A third spec touching this form would need the limit raised or the
 * counter reset, not another test file.
 */
test.describe.configure({ mode: 'serial' });

test.describe('demo request', () => {
  test('refuses an incomplete form without losing what was typed', async ({ page }) => {
    await page.goto('/contact');

    const brief = 'Approvals take a week and nobody can say who is holding them.';

    // A real address is deliberately absent, and the brief is deliberately
    // long: the point of the assertion is that the refusal costs the visitor
    // nothing they would have to type again.
    await page.getByLabel('Full name').fill('Grace Sharma');
    await page.getByLabel('Work email').fill('not-an-address');
    await page.getByLabel('Company').fill('Acme Ltd');
    await page.getByLabel('What are you trying to fix?').fill(brief);

    await page.getByRole('button', { name: 'Request a demo' }).click();

    // The API named the field, so the message belongs under that input.
    await expect(page.getByText('must be a valid email address')).toBeVisible();
    await expect(page.getByLabel('Work email')).toHaveAttribute('aria-invalid', 'true');

    // The whole point of the failure path: nothing was cleared.
    await expect(page.getByLabel('What are you trying to fix?')).toHaveValue(brief);
    await expect(page.getByLabel('Full name')).toHaveValue('Grace Sharma');

    // And the URL is untouched — no GET submission put the answers in the
    // query string, which is what the unwired form used to do.
    await expect(page).toHaveURL(/\/contact$/);
  });

  test('accepts a complete one and says so', async ({ page }) => {
    await page.goto('/contact');

    // Unique per run, so a re-run is a new lead rather than one the API
    // deduplicates into the previous run's row.
    const email = `e2e-${Date.now()}@example.test`;

    await page.getByLabel('Full name').fill('Grace Sharma');
    await page.getByLabel('Work email').fill(email);
    await page.getByLabel('Company').fill('Acme Ltd');
    await page.getByLabel('Team size').fill('50–200');
    await page
      .getByLabel('What are you trying to fix?')
      .fill('Closing the month takes a week and receipts arrive late.');

    await page.getByRole('button', { name: 'Request a demo' }).click();

    // Success replaces the form rather than sitting above it. A confirmation
    // next to a still-submittable form is what produces the duplicate lead.
    await expect(page.getByText('Request received')).toBeVisible();
    await expect(page.getByText('reached us')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Request a demo' })).toHaveCount(0);
  });
});
