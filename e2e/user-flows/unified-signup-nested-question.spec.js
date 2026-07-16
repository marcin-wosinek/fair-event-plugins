/**
 * E2E: signup with a custom question nested in the unified Event Signup
 * block, delegated through fair-audience's participant-aware flow (#1160).
 *
 * The unified fair-events/event-signup block now accepts nested fair-form
 * question blocks and forwards them, unchanged, to the legacy
 * fair-audience/event-signup render when fair-audience is active. This drives
 * a real free signup through the browser with a nested short-text question to
 * prove the question renders on the unified block and the signup completes.
 */

import { test, expect } from '../support/fixtures.js';

test.describe('unified event-signup block: nested custom question', () => {
	test('a free signup with a custom question completes', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free', { block: 'unified-with-question' });
		const stamp = Date.now();
		const email = `unified.question.${stamp}@example.test`;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-audience-signup-register');
		await expect(form).toBeVisible();

		// The nested fair-form question, forwarded through the delegated
		// render, appears alongside the name/email fields.
		const question = form.locator('[data-question-key="dietary"]');
		await expect(question).toBeVisible();
		await expect(question).toContainText('Dietary needs');

		await form.locator('input[name="signup_name"]').fill('Unified Visitor');
		await form.locator('input[name="signup_email"]').fill(email);
		await question.locator('input[type="text"]').fill('No nuts');

		await form.locator('.fair-audience-signup-submit-button').click();

		await expect(
			page.getByText('You are signed up for this event', {
				exact: false,
			})
		).toBeVisible();
	});
});
