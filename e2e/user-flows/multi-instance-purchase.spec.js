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
 *
 * Both this purchase and a whole-series pass also check the connector's
 * ticket buyer email setting (#1484): the email reaches the Mollie payload
 * only while it is on, and stays on the local transaction either way.
 */

import { test, expect } from '../support/fixtures.js';
import {
	runScript,
	ticketBuyerEmailSharing,
	setTicketBuyerEmailSharing,
} from '../support/wp-cli.js';

test.describe('multiple_instances ticket type purchase (new buyer)', () => {
	let originalEmailSharing;

	test.beforeAll(() => {
		originalEmailSharing = ticketBuyerEmailSharing();
	});

	test.afterAll(() => {
		setTicketBuyerEmailSharing(originalEmailSharing);
	});

	for (const shareEmail of [true, false]) {
		test(`charges the sum of all chosen occurrences, not just one (buyer email ${
			shareEmail ? 'sent' : 'not sent'
		} to the provider)`, async ({
			page,
			seedEvent,
		}) => {
			setTicketBuyerEmailSharing(shareEmail);
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

			// The checkout total already reflects all 3 chosen occurrences.
			const expectedTotal = (
				event.price * event.occurrenceIds.length
			).toFixed(2);
			const checkoutTotal = form.locator(
				'.fair-events-signup-checkout-total'
			);
			await expect(checkoutTotal).toHaveAttribute(
				'data-amount',
				expectedTotal
			);
			await expect(
				checkoutTotal.locator('.fair-events-signup-checkout-total-amount')
			).toHaveText(`${expectedTotal} EUR`);

			const stamp = Date.now();
			await form
				.locator('input[name="name"]')
				.fill(`E2E Multi Instance ${stamp}`);
			const email = `multi-instance-${stamp}@example.test`;
			await form
				.locator('input[name="email"]')
				.fill(email);

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

			const state = runScript(
				'get-tickets-state.php',
				'E2E_GT_STATE',
				String(event.occurrenceIds[0])
			);
			if (shareEmail) {
				expect(state.mollie_payload.metadata.email).toBe(email);
			} else {
				expect(state.mollie_payload.metadata).not.toHaveProperty('email');
			}
			expect(state.mollie_payload.metadata.signup_ids).toHaveLength(3);
			expect(state.mollie_payload.metadata.transaction_id).toBe(
				Number(transactionId)
			);
			expect(tx.metadata.email).toBe(email);
		});
	}

	test('a whole-series pass follows the ticket buyer email setting', async ({
		page,
		seedEvent,
	}) => {
		setTicketBuyerEmailSharing(false);
		const event = seedEvent('three-ticket-scopes', { omitMulti: true });
		const [wholeSeriesTypeId] = event.extraTypeIds;

		await page.goto(event.pageUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		await form
			.locator(
				`input[name="ticket_type_id"][value="${wholeSeriesTypeId}"]`
			)
			.check();

		const stamp = Date.now();
		const email = `whole-series-${stamp}@example.test`;
		await form
			.locator('input[name="name"]')
			.fill(`E2E Whole Series ${stamp}`);
		await form.locator('input[name="email"]').fill(email);

		await form.locator('.form-button').click();
		await expect(page).toHaveURL(/fair_payment_callback=true/, {
			timeout: 30000,
		});

		const transactionId = new URL(page.url()).searchParams.get(
			'transaction_id'
		);
		const tx = runScript(
			'transaction-state.php',
			'E2E_TX_STATE',
			transactionId
		);
		expect(tx.found).toBe(true);
		expect(tx.metadata.email).toBe(email);

		const state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.occurrenceIds[0])
		);
		expect(state.mollie_payload.metadata).not.toHaveProperty('email');
		expect(state.mollie_payload.metadata.source).toBe(
			'fair-events-get-tickets'
		);
		expect(state.mollie_payload.metadata.transaction_id).toBe(
			Number(transactionId)
		);
	});
});
