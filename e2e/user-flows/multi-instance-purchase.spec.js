/**
 * E2E: 'multiple_instances' ticket type purchase — pick-N occurrences at a
 * per-instance price, through the public (anonymous, first-time buyer)
 * registration form.
 *
 * Reproduces a reported bug: the buyer picks 3 occurrences of a series priced
 * at 10.00 each. The frontend total (basePrice * checked count, see
 * frontend.js updateButtonTotal()/updateInstancePickerHint()) correctly shows
 * 30.00 — but the amount actually charged (the transaction row, and therefore
 * what's sent to Mollie) is only 10.00, the per-instance price for a single
 * occurrence.
 *
 * Root cause (not fixed here — this spec documents the bug; the fix is a
 * separate change): EventSignupController::create_signup() dispatches
 * 'multiple_instances' ticket types to create_multi_instance_signup(), which
 * correctly sums the per-instance price across every chosen occurrence. But
 * EventSignupController::register_and_signup() — the endpoint the public
 * "I'm new" form submits to, used by every first-time buyer — has no such
 * dispatch. It always falls through to maybe_start_paid_signup(), which
 * resolves a single per-instance price and ignores event_date_ids entirely.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

test.describe('multiple_instances ticket type purchase (new buyer)', () => {
	test('charges the sum of all chosen occurrences, not just one', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('multiple-instances');
		expect(event.occurrenceIds.length).toBe(3);

		await page.goto(event.pageUrl);
		const form = page.locator('.fair-audience-signup-register');
		await expect(form).toBeVisible();

		const ticket = form.locator('input[name="ticket_type_id"]');
		await ticket.check();
		expect(await ticket.getAttribute('data-recurrence-scope')).toBe(
			'multiple_instances'
		);

		const instancePicker = form.locator('.fair-audience-instance-picker');
		await expect(instancePicker).toBeVisible();

		for (const occurrenceId of event.occurrenceIds) {
			await form
				.locator(
					`input[name="event_date_ids[]"][value="${occurrenceId}"]`
				)
				.check();
		}

		// Frontend total already reflects all 3 chosen occurrences.
		const expectedTotal = (
			event.price * event.occurrenceIds.length
		).toFixed(2);
		await expect(
			instancePicker.locator('.fair-audience-instance-picker-total')
		).toHaveText(`Total: €${expectedTotal}`);

		const stamp = Date.now();
		await form
			.locator('input[name="signup_name"]')
			.fill(`E2E Multi Instance ${stamp}`);
		await form
			.locator('input[name="signup_email"]')
			.fill(`multi-instance-${stamp}@example.test`);

		// Submit → register REST call. Via the Mollie double, the checkout URL
		// points back at the signup callback with the transaction id.
		await form.locator('.fair-audience-signup-submit-button').click();
		await expect(page).toHaveURL(/fair_signup_tx=/, { timeout: 30000 });

		const url = new URL(page.url());
		const transactionId = url.searchParams.get('fair_signup_tx');
		expect(transactionId).toBeTruthy();

		const tx = runScript(
			'transaction-state.php',
			'E2E_TX_STATE',
			transactionId
		);
		expect(tx.found).toBe(true);

		// This is the bug: today the transaction is created for a single
		// instance's price (10.00) instead of the sum across all 3 chosen
		// occurrences (30.00) that the buyer was shown and agreed to pay.
		expect(tx.amount).toBe(Number(expectedTotal));
	});
});
