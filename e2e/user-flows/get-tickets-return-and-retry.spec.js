/**
 * E2E: return-from-payment states and retry in the get-tickets block (#1244).
 *
 * Covers the failed → retry → confirmed path: a payment that Mollie reports
 * as failed by the time the buyer returns shows the retry card (server-
 * resolved on that very first render — SignupPaymentState's "sync before you
 * read" runs on every render of a callback/session-resolved transaction, and
 * the connector only re-checks Mollie while a transaction is still in its
 * freshly-initiated 'pending_payment' state, so this is the one point where
 * the double's canned status actually lands); retrying creates a fresh
 * transaction and, once Mollie reports it paid, confirms in the same way.
 *
 * Uses the Mollie double's settable GET status (set-mollie-status.php,
 * #1244 Decisions #8) rather than driving a real checkout, mirroring
 * get-tickets-purchase.spec.js's use of the webhook double for the
 * already-covered straight-through paid path. Runs with fair-audience active
 * (the .wp-env.json default, and the only signup path since #1245) — its
 * render-context/render-slot enrichment doesn't touch this anonymous
 * return/retry path, so no deactivation is needed here anymore.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

test.describe('get-tickets block: return and retry', () => {
	test.afterEach(() => {
		// Leave the double reporting "paid" for every other spec's assumption.
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
	});

	test('a failed payment shows a retry card, and retrying it can succeed', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid', { block: 'get-tickets' });

		const stamp = Date.now();
		const email = `get-tickets.retry.${stamp}@example.test`;

		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'failed');

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await form.locator('input[name="name"]').fill(`Retry Buyer ${stamp}`);
		await form.locator('input[name="email"]').fill(email);
		await form
			.locator(
				`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
			)
			.check();
		await form.locator('button[type="submit"]').click();

		const retryCard = page.locator(
			'.fair-events-get-tickets-callback-retry'
		);
		await expect(retryCard).toBeVisible({ timeout: 30000 });
		await expect(
			page.getByText("Your payment didn't go through")
		).toBeVisible();

		let state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		expect(state.signups).toHaveLength(1);
		expect(state.signups[0].status).toBe('failed');
		expect(state.signups[0].transaction_status).toBe('failed');

		// The buyer's card works this time.
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');

		await retryCard
			.locator('.fair-events-get-tickets-callback-retry-button')
			.click();

		await expect(
			page.locator('.fair-events-get-tickets-callback-confirmed')
		).toBeVisible({ timeout: 30000 });
		await expect(page.getByText('Payment confirmed')).toBeVisible();

		// Same signup row, now re-pointed at the retry's new (paid) transaction.
		state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		expect(state.signups).toHaveLength(1);
		expect(state.signups[0].email).toBe(email);
		expect(state.signups[0].status).toBe('confirmed');
		expect(state.signups[0].transaction_status).toBe('paid');
		expect(state.mollie_payload.metadata.email).toBe(email);
		expect(state.mollie_payload.metadata.retry_of_transaction_id).toBeTruthy();
	});
});
