/**
 * E2E: abandoning a payment and starting over (fair-events get-tickets block).
 *
 * Companion to signup-cancel-and-restart.spec.js, which found that the
 * fair-audience event-signup block's "Cancel and start over" link is a no-op —
 * clicking it re-shows the identical stuck retry screen because render.php
 * re-derives that screen from a persistent per-participant DB row that the
 * link never clears.
 *
 * The get-tickets block has no such identity to get stuck against: it doesn't
 * link the page render to a signed-up participant/session at all (buyers
 * aren't known until they submit name+email), so there's no server-side
 * "resume the in-progress payment" fallback to go stale. This spec asserts
 * that behaviour holds: a buyer who starts a paid checkout and then goes back
 * to the event page (Mollie's redirect never followed / abandoned) sees a
 * plain, fresh form — not stuck on the earlier processing state — and can
 * complete a brand new purchase from it.
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
	});

	test('going back after starting a paid checkout shows a fresh form the buyer can complete', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid', { block: 'get-tickets' });

		const stamp = Date.now();
		const abandonedEmail = `get-tickets.abandoned.${stamp}@example.test`;

		await page.goto(event.pageUrl);

		let form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		await form.locator('input[name="name"]').fill(`Abandoned ${stamp}`);
		await form.locator('input[name="email"]').fill(abandonedEmail);
		await form
			.locator('select[name="ticket_type_id"]')
			.selectOption(String(event.ticketTypeId));

		// Submit → redirected through the Mollie double to the callback URL,
		// which only polls; the buyer never lands on a confirmed state because
		// no webhook fires here — this models an abandoned/failed attempt.
		await form.locator('button[type="submit"]').click();
		await expect(page.locator('.message-processing')).toBeVisible({
			timeout: 30000,
		});

		// The buyer gives up and goes back to the plain event page instead of
		// completing or retrying the Mollie checkout.
		await page.goto(event.pageUrl);

		form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		// No leftover processing/error message from the abandoned attempt (the
		// block always renders an empty `.message-container` for its JS to fill
		// in later — only the populated status classes indicate a stuck state).
		await expect(page.locator('.message-processing')).toHaveCount(0);
		await expect(page.locator('.message-error')).toHaveCount(0);
		await expect(page.locator('.message-success')).toHaveCount(0);

		// A completely fresh purchase (different buyer identity) works.
		const buyerEmail = `get-tickets.fresh.${stamp}@example.test`;
		await form.locator('input[name="name"]').fill(`Fresh Buyer ${stamp}`);
		await form.locator('input[name="email"]').fill(buyerEmail);
		await form
			.locator('select[name="ticket_type_id"]')
			.selectOption(String(event.ticketTypeId));
		await form.locator('button[type="submit"]').click();
		await expect(page.locator('.message-processing')).toBeVisible({
			timeout: 30000,
		});

		const state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		// Both the abandoned attempt and the fresh purchase left their own
		// pending signup row — the abandoned one was never blocking the retry.
		expect(state.signups).toHaveLength(2);
		expect(state.signups.map((s) => s.email).sort()).toEqual(
			[abandonedEmail, buyerEmail].sort()
		);
	});
});
