/**
 * E2E: selectable activities (ticket options) in the unified Event Signup
 * form (#1243, re-pointed at the unified markup by #1245).
 *
 * The activities fieldset only ever renders when fair-audience is active
 * (`class_exists( \FairAudience\API\EventSignupController::class )` —
 * selections can only be persisted through its options table), and before
 * #1245 the base render also only ran when fair-audience was *inactive* —
 * two mutually exclusive preconditions, so only the negative case (base-alone
 * site, fieldset absent) was ever reachable end-to-end. #1245 removed that
 * delegation guard, so the positive path — fieldset renders, a selection
 * persists through a real signup — is now covered here too. API-level
 * coverage for the create-route validation/pricing logic lives in
 * fair-audience/src/API/__tests__/EventSignupActivities.api.spec.js.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, runScript } from '../support/wp-cli.js';

test.describe('Activities fieldset (fair-audience active)', () => {
	test('a free signup with an activity selected persists the selection', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('unified-with-options', {
			price: 0,
			options: ['dinner'],
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

test.describe('Activities fieldset base-alone guard (fair-audience inactive)', () => {
	test.beforeAll(() => {
		wpCli('plugin deactivate fair-audience fair-audience-experimental');
	});

	test.afterAll(() => {
		wpCli('plugin activate fair-audience fair-audience-experimental');
	});

	test('activities configured on the event never render dead checkboxes when fair-audience is absent', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('unified-with-options', {
			options: ['dinner', 'tshirt'],
		});

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		// Selections could never be persisted without fair-audience's options
		// table, so the fieldset must be entirely absent — not just hidden.
		await expect(form.locator('.fair-events-ticket-options')).toHaveCount(
			0
		);
		await expect(
			form.locator('input[name="ticket_option_ids[]"]')
		).toHaveCount(0);

		// The rest of the form still works unaffected.
		await expect(form.locator('input[name="ticket_type_id"]')).toHaveCount(
			1
		);
	});
});
