/**
 * E2E: a page saved with the removed fair-audience/event-signup block keeps
 * working for visitors (#1701).
 *
 * The block's own editor, script, styles and form are gone; a render-only
 * alias shows such content as the Event Signup block. This drives a real free
 * signup through a page whose stored content still names the old block, with
 * customized button text and nested questions, to prove a visitor still gets
 * a working form with both carried over.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

test.describe('content saved with the removed fair-audience signup block', () => {
	test('shows the Event Signup form with its button text and questions, and signs a visitor up', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free', { block: 'saved-audience-signup' });
		const email = `saved.block.${Date.now()}@example.test`;

		const assetRequests = [];
		page.on('request', (request) => {
			if (
				request
					.url()
					.includes('fair-audience/build/blocks/event-signup')
			) {
				assetRequests.push(request.url());
			}
		});

		await page.goto(event.pageUrl);

		// No raw block markup reaches the visitor.
		await expect(page.locator('body')).not.toContainText(
			'wp:fair-audience'
		);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await expect(form.locator('button[type="submit"]')).toHaveText(
			'Join the retreat'
		);

		// Nested questions keep their saved order.
		const questionKeys = await form
			.locator('[data-question-key]')
			.evaluateAll((elements) =>
				elements.map((element) => element.dataset.questionKey)
			);
		expect(questionKeys).toEqual(['dietary', 'arrival']);

		await form.locator('input[name="name"]').fill('Saved Block Visitor');
		await form.locator('input[name="email"]').fill(email);
		await form
			.locator('[data-question-key="dietary"] input[type="text"]')
			.fill('No nuts');
		await form
			.locator('[data-question-key="arrival"] input[type="text"]')
			.fill('Friday evening');

		await form.locator('button[type="submit"]').click();
		await expect(
			page.getByText('You have successfully registered', {
				exact: false,
			})
		).toBeVisible();

		const state = runScript(
			'signup-state.php',
			'E2E_STATE',
			`${email} ${event.eventDateId}`
		);
		expect(state.label).toBe('signed_up');
		expect(assetRequests).toEqual([]);
	});
});
