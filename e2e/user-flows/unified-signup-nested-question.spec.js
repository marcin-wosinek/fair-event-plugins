/**
 * E2E: signup with a custom question nested in the unified Event Signup
 * block (#1160, re-pointed at the unified markup by #1245).
 *
 * The unified fair-events/event-signup block accepts nested fair-form
 * question blocks and forwards them, unchanged, as inner block content
 * (render.php echoes $content inside the form). This drives a real free
 * signup through the browser with a nested short-text question to prove the
 * question renders on the unified block and the signup completes.
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

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		// The nested fair-form question, forwarded as inner block content,
		// appears alongside the name/email fields.
		const question = form.locator('[data-question-key="dietary"]');
		await expect(question).toBeVisible();
		await expect(question).toContainText('Dietary needs');

		await form.locator('input[name="name"]').fill('Unified Visitor');
		await form.locator('input[name="email"]').fill(email);
		await question.locator('input[type="text"]').fill('No nuts');

		await form.locator('.form-button').click();

		await expect(
			page.getByText('You have successfully registered', {
				exact: false,
			})
		).toBeVisible();
	});
});
