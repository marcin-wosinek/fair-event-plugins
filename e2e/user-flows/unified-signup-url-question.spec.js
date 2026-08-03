/**
 * E2E: signup with a URL question nested in the unified Event Signup block
 * (#1326). A bare domain typed the way people actually write it — no
 * `https://` prefix — must be accepted and complete the signup, mirroring
 * unified-signup-phone-question.spec.js for the phone question.
 */

import { test, expect } from '../support/fixtures.js';

test.describe('unified event-signup block: nested URL question', () => {
	test('a free signup with a bare-domain URL completes', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free', { block: 'unified-with-url' });
		const stamp = Date.now();
		const email = `unified.url.${stamp}@example.test`;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		const question = form.locator('[data-question-key="website"]');
		await expect(question).toBeVisible();
		await expect(question).toContainText('Website');

		await form.locator('input[name="name"]').fill('Unified Visitor');
		await form.locator('input[name="email"]').fill(email);
		await question.locator('input').fill('example.com/my-portfolio');

		await form.locator('.form-button').click();

		await expect(
			page.getByText('You have successfully registered', {
				exact: false,
			})
		).toBeVisible();
	});
});
