/**
 * E2E: selectable activities (ticket options) in the unified Event Signup
 * form (#1243, re-pointed at the unified markup by #1245), with fair-audience
 * active: the fieldset renders and a selection persists through a real
 * signup onto the participant. The same form without fair-audience — where
 * fair-events sells the add-ons on its own — is covered by
 * addon-pricing-standalone.spec.js. API-level coverage for validation and
 * pricing lives in fair-events' and fair-audience's
 * ActivityOptionPricing.api.spec.js.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

test.describe('Activities fieldset (fair-audience active)', () => {
	test('a free signup with an activity selected persists the selection', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('unified-with-options', {
			price: 0,
			options: ['dinner'],
			optionPrice: 0,
		});
		const stamp = Date.now();
		const email = `unified.activities.${stamp}@example.test`;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		const optionsFieldset = form.locator('.fair-events-ticket-options');
		await expect(optionsFieldset).toBeVisible();

		const dinnerCheckbox = form.locator(
			'input[name="ticket_option_ids[]"]'
		);
		await expect(dinnerCheckbox).toHaveCount(1);
		await dinnerCheckbox.check();

		await form.locator('input[name="name"]').fill('Activities Buyer');
		await form.locator('input[name="email"]').fill(email);
		await form.locator('.form-button').click();

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
		expect(state.found).toBe(true);
		expect(state.label).toBe('signed_up');
		expect(state.option_ids).toContain(event.optionIds[0]);
	});
});
