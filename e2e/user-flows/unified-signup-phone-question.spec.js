/**
 * E2E: signup with a phone question nested in the unified Event Signup block
 * (#1267). A phone number written the way people actually write it —
 * separators and all — must be accepted by the browser's own field
 * constraint and complete the signup, mirroring
 * unified-signup-nested-question.spec.js for the short-text question.
 */

import { test, expect } from '../support/fixtures.js';

test.describe('unified event-signup block: nested phone question', () => {
	test('a free signup with a spaced-out phone number completes', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free', { block: 'unified-with-phone' });
		const stamp = Date.now();
		const email = `unified.phone.${stamp}@example.test`;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-audience-signup-register');
		await expect(form).toBeVisible();

		const question = form.locator('[data-question-key="mobile"]');
		await expect(question).toBeVisible();
		await expect(question).toContainText('Mobile');

		await form.locator('input[name="signup_name"]').fill('Unified Visitor');
		await form.locator('input[name="signup_email"]').fill(email);
		await question.locator('input[type="tel"]').fill('+49 170 123 45 67');

		await form.locator('.fair-audience-signup-submit-button').click();

		await expect(
			page.getByText('You are signed up for this event', {
				exact: false,
			})
		).toBeVisible();
	});
});
