/**
 * E2E: the phone question's placeholder is derived from the site timezone
 * (#1269) — a Spanish example on a `Europe/Madrid` site, the German fallback
 * example on an unmapped timezone. Uses the same `unified-with-phone` seed
 * flavour as unified-signup-phone-question.spec.js (#1267).
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli } from '../support/wp-cli.js';

test.describe('phone question placeholder: derived from site timezone', () => {
	let originalTimezone;

	test.beforeAll(() => {
		originalTimezone = wpCli('option get timezone_string', {
			allowFailure: true,
		}).trim();
	});

	test.afterAll(() => {
		wpCli(`option update timezone_string "${originalTimezone}"`);
	});

	test('a Europe/Madrid site shows the Spanish example placeholder', async ({
		page,
		seedEvent,
	}) => {
		wpCli('option update timezone_string Europe/Madrid');

		const event = seedEvent('free', { block: 'unified-with-phone' });
		await page.goto(event.pageUrl);

		const question = page.locator('[data-question-key="mobile"]');
		await expect(question).toBeVisible();
		await expect(question.locator('input[type="tel"]')).toHaveAttribute(
			'placeholder',
			'+34 612 34 56 78'
		);
	});

	test('an unmapped timezone shows the fallback example placeholder', async ({
		page,
		seedEvent,
	}) => {
		wpCli('option update timezone_string Pacific/Auckland');

		const event = seedEvent('free', { block: 'unified-with-phone' });
		await page.goto(event.pageUrl);

		const question = page.locator('[data-question-key="mobile"]');
		await expect(question).toBeVisible();
		await expect(question.locator('input[type="tel"]')).toHaveAttribute(
			'placeholder',
			'+49 170 1234567'
		);
	});
});
