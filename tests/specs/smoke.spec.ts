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
