/**
 * E2E: fair-events standalone ticket purchase via the get-tickets block.
 *
 * The get-tickets block (fair-events 1.7.0) is the purchase path for sites
 * running fair-events WITHOUT fair-audience — the block render defers to the
 * Event Signup block whenever fair-audience is active, and the
 * GetTicketsController REST route is only registered when fair-audience's
 * EventSignupController class is absent. So this suite deactivates
 * fair-audience for its duration (and reactivates it afterwards; the whole
 * Playwright run is single-worker/serial, so no other spec runs in between).
 *
 * Covers both branches of the block:
 *   - free ticket type → immediate confirmation, signup row 'confirmed' with
 *     no transaction;
 *   - paid ticket type → payment_required, redirect through the Mollie double
 *     back to the callback URL, webhook flips the transaction to paid (the
 *     production path — Mollie calls /webhook; the redirect page itself only
 *     polls), fair_payment_paid → FairEvents PaymentHooks confirms the signup,
 *     and the block UI shows the success message.
 *
 * The get-tickets endpoint rate-limits by IP (3/hour), so transients are
 * cleared before each test to keep repeated local runs deterministic.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, runScript } from '../support/wp-cli.js';

test.describe('get-tickets block purchase (fair-audience inactive)', () => {
	test.beforeAll(() => {
		wpCli('plugin deactivate fair-audience');
	});

	test.afterAll(() => {
		wpCli('plugin activate fair-audience');
	});

	test.beforeEach(() => {
		// Reset the get-tickets per-IP rate limit (3 requests/hour).
		wpCli('transient delete --all');
	});

	test('paid ticket: checkout via the Mollie double, webhook confirms the signup', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid', { block: 'get-tickets' });

		const stamp = Date.now();
		const buyerName = `E2E GetTickets Paid ${stamp}`;
		const email = `get-tickets.paid.${stamp}@example.test`;

		await page.goto(event.pageUrl);

		// The standalone form must render — not the "fair-audience is active"
		// deferral notice (which would mean the deactivation didn't take).
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await expect(
			page.locator('.fair-events-get-tickets-notice')
		).toHaveCount(0);

		await form.locator('input[name="name"]').fill(buyerName);
		await form.locator('input[name="email"]').fill(email);
		await form
			.locator('select[name="ticket_type_id"]')
			.selectOption(String(event.ticketTypeId));

		// Submit → payment_required with a checkout_url that (via the Mollie
		// double) is the callback URL itself, so the browser lands straight on
		// ?fair_payment_callback=true&transaction_id=…&token=…. Wait for the
		// rendered processing state rather than the navigation itself
		// (waitForURL can abort when a redirect supersedes it — see
		// ticket-purchase-confirmation.spec.js), then assert the URL by polling.
		await form.locator('button[type="submit"]').click();
		await expect(page.locator('.message-processing')).toBeVisible({
			timeout: 30000,
		});
		await expect(page).toHaveURL(/fair_payment_callback=true/);

		// The signup row is pending and its transaction still open — the
		// redirect page only polls; Mollie's webhook is what flips the status.
		let state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		expect(state.signups).toHaveLength(1);
		expect(state.signups[0].email).toBe(email);
		expect(state.signups[0].status).toBe('pending_payment');
		expect(state.signups[0].amount).toBe(event.price);
		expect(state.signups[0].mollie_payment_id).toBeTruthy();

		// Simulate Mollie's webhook call (production path). The handler fetches
		// the payment from the double, which reports it paid, and fires the real
		// fair_payment_paid → FairEvents\Hooks\PaymentHooks chain.
		const webhookResponse = await page.request.post(
			'/wp-json/fair-payments-connector/v1/webhook',
			{ form: { id: state.signups[0].mollie_payment_id } }
		);
		expect(webhookResponse.ok()).toBe(true);

		// The block's callback poller picks the paid status up and swaps the
		// form for the success message.
		await expect(
			page.getByText('Your ticket purchase was successful', {
				exact: false,
			})
		).toBeVisible({ timeout: 30000 });

		// Server-side: signup confirmed, transaction paid (in test mode).
		state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		expect(state.signups[0].status).toBe('confirmed');
		expect(state.signups[0].transaction_status).toBe('paid');
		expect(state.signups[0].transaction_testmode).toBe(true);
	});

	test('free ticket: immediate confirmation without any transaction', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free', { block: 'get-tickets' });

		const stamp = Date.now();
		const email = `get-tickets.free.${stamp}@example.test`;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		await form
			.locator('input[name="name"]')
			.fill(`E2E GetTickets Free ${stamp}`);
		await form.locator('input[name="email"]').fill(email);
		await form
			.locator('select[name="ticket_type_id"]')
			.selectOption(String(event.ticketTypeId));

		await form.locator('button[type="submit"]').click();

		// Free path confirms in place — no redirect, form hidden.
		await expect(
			page.getByText('You have successfully registered', { exact: false })
		).toBeVisible({ timeout: 15000 });
		await expect(form).toBeHidden();

		const state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		expect(state.signups).toHaveLength(1);
		expect(state.signups[0].email).toBe(email);
		expect(state.signups[0].status).toBe('confirmed');
		expect(state.signups[0].amount).toBe(0);
		expect(state.signups[0].transaction_id).toBeNull();
	});
});
