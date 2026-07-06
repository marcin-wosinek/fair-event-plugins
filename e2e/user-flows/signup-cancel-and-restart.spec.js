/**
 * E2E: "Cancel and start over" on a stuck payment (fair-audience event-signup
 * block).
 *
 * Reported bug: a buyer whose Mollie payment failed (or who just navigates
 * back to the event page instead of following Mollie's redirect) sees the
 * retry screen — "Your payment didn't go through." / Retry payment / Cancel
 * and start over — and the "Cancel and start over" link does nothing useful.
 *
 * Root cause (event-signup/render.php): the link is a plain
 * `remove_query_arg( ['fair_payment_callback', 'fair_signup_tx'] )` href — it
 * only strips those two URL params. But render.php also re-synthesises the
 * exact same retry state from the database whenever the visitor has a
 * participant with an event_participants row still labelled 'pending_payment'
 * and a transaction in a retriable status (the "no URL callback? look up an
 * in-progress payment" fallback, issue #554). Since clicking the link never
 * clears that DB state, reloading — with or without the query params — just
 * re-shows the identical retry screen. It's a complete no-op whenever the
 * buyer reached the page any way other than fresh off Mollie's own redirect
 * (e.g. a bookmarked link, the confirmation email's link, or simply going
 * back), which is exactly how the bug was found in production.
 *
 * The Mollie double (lib/mollie-http-double.php) always reports "paid" on
 * GET, so a failed/canceled transaction can't be produced by driving a real
 * checkout — seed-pending-signup.php writes the stuck state directly, the way
 * a real stalled payment would leave the database.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

test.describe('event-signup block: cancel a stuck payment and restart', () => {
	test('"Cancel and start over" clears the pending payment and lets the buyer sign up again', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid');

		const pending = runScript(
			'seed-pending-signup.php',
			'E2E_PENDING',
			`${event.eventId} ${event.eventDateId} ${event.ticketTypeId} ${event.price} failed`
		);

		try {
			// Visit the plain participant-token URL — no fair_payment_callback /
			// fair_signup_tx query args, exactly like a buyer returning to the
			// page directly (bookmark, email link, or hitting Back) rather than
			// arriving fresh off Mollie's redirect.
			await page.goto(
				`${event.pageUrl}?participant_token=${pending.token}`
			);

			const retryPanel = page.locator('.fair-audience-signup-retry');
			await expect(retryPanel).toBeVisible();
			await expect(
				page.getByText("Your payment didn't go through", {
					exact: false,
				})
			).toBeVisible();

			// Click "Cancel and start over".
			await page.locator('.fair-audience-signup-retry-cancel a').click();
			await page.waitForLoadState();

			// The retry screen must be gone — the buyer should see a normal,
			// fresh signup form they can complete, not the same stuck state.
			await expect(
				page.locator('.fair-audience-signup-retry')
			).toHaveCount(0);
			const form = page.locator(
				'.fair-audience-signup-token-form, .fair-audience-signup-anonymous'
			);
			await expect(form).toBeVisible();

			// Server-side: the abandoned attempt must actually be cleared, not
			// just hidden client-side — otherwise the same stuck state would
			// resurface on the buyer's next visit (e.g. reloading the same
			// participant-token link, or clicking it again from an email).
			const state = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${pending.email} ${event.eventDateId}`
			);
			expect(state.label).not.toBe('pending_payment');
		} finally {
			runScript(
				'cleanup-transaction.php',
				'E2E_TX_CLEANUP',
				String(pending.transactionId)
			);
		}
	});
});
