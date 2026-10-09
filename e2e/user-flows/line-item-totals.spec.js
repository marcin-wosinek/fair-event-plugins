/**
 * E2E: a signup whose price is a fraction of a cent goes the way its
 * rounded total says (#1366).
 *
 * The Event Signup form posts the purchase and follows the answer: a total
 * that rounds to nothing confirms the registration at once, and the smallest
 * total there is to pay — one cent — sends the buyer through checkout. The
 * signup row, the transaction and its ledger line items hold that same
 * amount.
 *
 * Stored prices have two decimals, so the fraction of a cent is put in place
 * by the test-only fair-e2e/v1/line-item-totals fixture, which overrides the
 * resolved ticket price the way a pricing extension would. Checkout runs
 * against the Mollie double, which reports the payment as paid.
 */

import { test, expect } from '../support/fixtures.js';

const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('signup totals around zero', () => {
	async function arm(request, ticketTypes = {}) {
		const response = await request.put(
			'/wp-json/fair-e2e/v1/line-item-totals/fixture',
			{ headers: adminHeaders, data: { ticket_types: ticketTypes } }
		);
		expect(response.ok()).toBe(true);
	}

	async function stored(request, eventDateId) {
		const response = await request.get(
			`/wp-json/fair-e2e/v1/line-item-totals?event_date_ids[]=${eventDateId}`,
			{ headers: adminHeaders }
		);
		expect(response.ok()).toBe(true);
		return response.json();
	}

	async function submitSignup(page, event, label) {
		const stamp = Date.now();

		await page.goto(event.pageUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		await form.locator('input[name="ticket_type_id"]').check();
		await form
			.locator('input[name="name"]')
			.fill(`E2E Totals ${label} ${stamp}`);
		await form
			.locator('input[name="email"]')
			.fill(`totals.${label}.${stamp}@example.test`);
		await form.locator('button[type="submit"]').click();
	}

	test.afterEach(async ({ request }) => {
		// Leave no price override behind for other specs.
		await arm(request);
	});

	test('a price below half a cent confirms the registration without payment', async ({
		page,
		request,
		seedEvent,
	}) => {
		const event = seedEvent('paid');
		await arm(request, { [event.ticketTypeId]: 0.004 });

		await submitSignup(page, event, 'free');

		await expect(
			page.getByText('You have successfully registered', {
				exact: false,
			})
		).toBeVisible();
		await expect(page).not.toHaveURL(/fair_payment_callback=true/);

		const { signups, transactions } = await stored(
			request,
			event.eventDateId
		);
		expect(signups).toHaveLength(1);
		expect(signups[0].amount).toBe('0.00');
		expect(signups[0].status).toBe('confirmed');
		expect(signups[0].transaction_id).toBeNull();
		expect(transactions).toEqual([]);
	});

	test('a price of half a cent is one cent to pay at checkout', async ({
		page,
		request,
		seedEvent,
	}) => {
		const event = seedEvent('paid');
		await arm(request, { [event.ticketTypeId]: 0.005 });

		await submitSignup(page, event, 'cent');

		// Wait for the confirmation UI rather than the navigation itself
		// (see ticket-purchase-confirmation.spec.js).
		await expect(
			page.getByText('Payment confirmed', { exact: false })
		).toBeVisible({ timeout: 30000 });
		await expect(page).toHaveURL(/fair_payment_callback=true/);

		const { signups, transactions } = await stored(
			request,
			event.eventDateId
		);
		expect(signups).toHaveLength(1);
		expect(signups[0].amount).toBe('0.01');
		expect(signups[0].status).toBe('confirmed');

		expect(transactions).toHaveLength(1);
		expect(transactions[0].id).toBe(signups[0].transaction_id);
		expect(transactions[0].amount).toBe('0.01');
		expect(transactions[0].status).toBe('paid');
		expect(
			transactions[0].line_items.map((line) => [
				line.quantity,
				line.unit_amount,
				line.total_amount,
			])
		).toEqual([[1, '0.01', '0.01']]);
	});
});
