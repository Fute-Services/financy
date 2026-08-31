import { expect, test } from '@playwright/test';

import { API_BASE_URL } from '../playwright.config.js';

/**
 * The Phase 0 smoke suite.
 *
 * It proves the harness itself works — browser, web app, API, and the wiring
 * between them — so that when the first real journey spec is written in
 * Phase 1, a failure means the journey is broken rather than the tooling.
 *
 * Product journeys (`auth`, `permissions`, `spend-approval`, …) arrive with
 * the features they cover, per `docs/16 §8`.
 */
test.describe('smoke', () => {
  test('the API answers its liveness probe', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/v1/health/live`);

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok' });
  });

  test('the API returns the published error envelope for an unknown route', async ({ request }) => {
    const response = await request.get(`${API_BASE_URL}/v1/definitely-not-a-route`);

    expect(response.status()).toBe(404);

    const body = (await response.json()) as { error: { code: string; correlationId: string } };
    expect(body.error.code).toBe('RESOURCE_NOT_FOUND');
    expect(body.error.correlationId).toBeTruthy();
  });

  test('the web app renders', async ({ page }) => {
    const response = await page.goto('/');

    expect(response?.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/financy/i);
  });

  /**
   * A console error on the first paint is nearly always a hydration mismatch
   * or a failed asset — both of which are real defects that no unit test sees.
   */
  test('the web app renders without console errors', async ({ page }) => {
    const errors: string[] = [];

    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    await page.goto('/');
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });
});

/**
 * The public site.
 *
 * `/` is the landing page now, not a redirect into the application. These
 * assertions exist because the page makes claims, and the one claim that must
 * never quietly disappear is the disclaimer: this product is not a bank and
 * holds no compliance certification.
 */
test.describe('landing page', () => {
  test('renders the hero and both calls to action', async ({ page }) => {
    await page.goto('/');

    await expect(page.getByRole('heading', { level: 1 })).toContainText('Most companies discover');
    await expect(page.getByRole('link', { name: 'Create an organisation' }).first()).toBeVisible();
  });

  test('states plainly that it is not a bank and holds no certification', async ({ page }) => {
    await page.goto('/');

    const footer = page.locator('footer');
    await expect(footer).toContainText('not a bank');
    await expect(footer).toContainText('no compliance certification');
  });

  test('does not send a signed-out visitor into the application', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveURL(/\/$/);
  });

  test('the calls to action reach sign in and sign up', async ({ page }) => {
    await page.goto('/');

    await page.getByRole('link', { name: 'Get started' }).click();
    await expect(page).toHaveURL(/\/register$/);

    await page.goto('/');
    await page.getByRole('link', { name: 'Sign in' }).first().click();
    await expect(page).toHaveURL(/\/login$/);
  });
});
