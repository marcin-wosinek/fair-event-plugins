/**
 * E2E: abandoning a payment and starting over (fair-events get-tickets block).
 *
 * Companion to signup-cancel-and-restart.spec.js (the fair-audience
 * equivalent). Rewritten for #1244: the base get-tickets form now has its own
 * direct-navigation fallback (FairEvents\Services\SignupPaymentSession, a
 * short-lived signed cookie set when create_signup() returns
 * payment_required) — a buyer who abandons Mollie's checkout and navigates
 * straight back to the event page (no provider redirect) sees the same
 * resume card the return-from-payment callback would show, within the
 * 15-minute hold window, and "Cancel and start over" clears it server-side
 * so a fresh purchase isn't blocked by the stale card resurrecting.
 *
 * Uses the Mollie double's settable GET status (set-mollie-status.php,
 * #1244 Decisions #8) to report "open" — a checkout link that was created
 * but never completed — so SignupPaymentState resolves 'resume' both on the
 * initial callback render and via the cookie fallback.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, runScript } from '../support/wp-cli.js';

test.describe('get-tickets block (fair-audience inactive): abandon and restart', () => {
	test.beforeAll(() => {
		wpCli('plugin deactivate fair-audience');
	});

	test.afterAll(() => {
		wpCli('plugin activate fair-audience');
	});

	test.beforeEach(() => {
		// Reset the get-tickets per-IP rate limit (3 requests/hour).
		wpCli('transient delete --all');
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'open');
	});

	test.afterEach(() => {
		// Leave the double reporting "paid" for every other spec's assumption.
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
	});

	test('abandoning checkout shows a resume card even via direct navigation, and canceling allows a fresh purchase', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid', { block: 'get-tickets' });

		const stamp = Date.now();
		const abandonedEmail = `get-tickets.abandoned.${stamp}@example.test`;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		await form.locator('input[name="name"]').fill(`Abandoned ${stamp}`);
		await form.locator('input[name="email"]').fill(abandonedEmail);
		await form
			.locator(
				`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
			)
			.check();

		// Submit → redirected through the Mollie double to the callback URL;
		// render.php syncs on that first load, pulls "open" (checkout created,
		// never finished) from the double, and shows the resume card.
		await form.locator('button[type="submit"]').click();
		const resumeCard = page.locator(
			'.fair-events-get-tickets-callback-resume'
		);
		await expect(resumeCard).toBeVisible({ timeout: 30000 });
		await expect(resumeCard.getByText('Continue payment')).toBeVisible();

		// The buyer gives up and navigates straight back to the plain event
		// page — no fair_payment_callback/transaction_id/token in the URL at
		// all. The session cookie set at checkout time is what recognises
		// them now.
		await page.goto(event.pageUrl);

		await expect(
			page.locator('.fair-events-get-tickets-callback-resume')
		).toBeVisible({ timeout: 15000 });
		await expect(page.locator('.fair-events-get-tickets-form')).toHaveCount(
			0
		);

		// Cancel and start over: clears the hold + cookie server-side, then
		// strips any callback params and reloads to a plain form.
		await page.getByRole('link', { name: 'Cancel and start over' }).click();

		const freshForm = page.locator('.fair-events-get-tickets-form');
		await expect(freshForm).toBeVisible({ timeout: 15000 });
		await expect(
			page.locator('.fair-events-get-tickets-callback')
		).toHaveCount(0);

		// A completely fresh purchase (different buyer identity) works, and
		// this time Mollie confirms it outright.
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
		const buyerEmail = `get-tickets.fresh.${stamp}@example.test`;
		await freshForm
			.locator('input[name="name"]')
			.fill(`Fresh Buyer ${stamp}`);
		await freshForm.locator('input[name="email"]').fill(buyerEmail);
		await freshForm
			.locator(
				`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
			)
			.check();
		await freshForm.locator('button[type="submit"]').click();
		await expect(
			page.locator('.fair-events-get-tickets-callback-confirmed')
		).toBeVisible({ timeout: 30000 });

		const state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		// The abandoned attempt was canceled (failed), the fresh purchase confirmed.
		expect(state.signups).toHaveLength(2);
		const abandoned = state.signups.find((s) => s.email === abandonedEmail);
		const fresh = state.signups.find((s) => s.email === buyerEmail);
		expect(abandoned.status).toBe('failed');
		expect(fresh.status).toBe('confirmed');
	});
});
