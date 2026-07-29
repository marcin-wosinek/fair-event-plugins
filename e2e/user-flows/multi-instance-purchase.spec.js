/**
 * E2E: 'multiple_instances' ticket type purchase — pick-N occurrences at a
 * per-instance price, through the unified Event Signup form (re-pointed at
 * the unified markup by #1245; seedEvent's default block since the cutover).
 *
 * Reproduces a reported bug: the buyer picks 3 occurrences of a series priced
 * at 10.00 each. The frontend total must show the sum across all chosen
 * occurrences (30.00) and the transaction actually created (what's sent to
 * Mollie) must match — not a single occurrence's per-instance price (10.00).
 *
 * Root cause (pre-cutover, on the legacy block): EventSignupController's
 * register endpoint didn't dispatch 'multiple_instances' ticket types the
 * same way its logged-in create_signup() path did. The unified route
 * (GetTicketsController::create_multi_instance_signup()) has always summed
 * correctly; this locks that in on the now-single signup path.
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
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		const ticket = form.locator('input[name="ticket_type_id"]');
		await ticket.check();
		expect(await ticket.getAttribute('data-recurrence-scope')).toBe(
			'multiple_instances'
		);

		const instancePicker = form.locator('.fair-events-instance-picker');
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
			instancePicker.locator('.fair-events-instance-picker-total')
		).toHaveText(`Total: ${expectedTotal} EUR`);

		const stamp = Date.now();
		await form
			.locator('input[name="name"]')
			.fill(`E2E Multi Instance ${stamp}`);
		await form
			.locator('input[name="email"]')
			.fill(`multi-instance-${stamp}@example.test`);

		// Submit → create-signup REST call. Via the Mollie double, the
		// checkout URL points back at the callback with the transaction id.
		await form.locator('.form-button').click();
		await expect(page).toHaveURL(/fair_payment_callback=true/, {
			timeout: 30000,
		});

		const url = new URL(page.url());
		const transactionId = url.searchParams.get('transaction_id');
		expect(transactionId).toBeTruthy();

		const tx = runScript(
			'transaction-state.php',
			'E2E_TX_STATE',
			transactionId
		);
		expect(tx.found).toBe(true);

		// The transaction must be created for the sum across all 3 chosen
		// occurrences (30.00), matching what the buyer was shown and agreed
		// to pay — not a single occurrence's price (10.00).
		expect(tx.amount).toBe(Number(expectedTotal));
	});
});
