/**
 * Paid signup confirmation capacity reconciliation (#1491).
 */

import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

const cases = [
	['event capacity', { eventCapacity: 1 }],
	['ticket capacity', { ticketCapacity: 1 }],
	['activity capacity', { optionCapacity: 1 }],
];

test.describe('paid signup confirmation capacity reconciliation', () => {
	test.afterEach(() => {
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
	});

	for (const [dimension, capacity] of cases) {
		test(`an active reservation filling the final ${dimension} place is not over capacity`, async ({
			page,
			seedEvent,
		}) => {
			const event = seedEvent('unified-with-options', {
				options: ['Workshop'],
				...capacity,
			});
			const email = `capacity.${dimension.replaceAll(
				' ',
				'.'
			)}.${Date.now()}@example.test`;

			runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'pending');
			await page.goto(event.pageUrl);
			const form = page.locator('.fair-events-get-tickets-form');
			await form.locator('input[name="name"]').fill('Capacity Buyer');
			await form.locator('input[name="email"]').fill(email);
			await form.locator('input[name="ticket_type_id"]').check();
			await form.locator('input[name="ticket_option_ids[]"]').check();
			await form.locator('button[type="submit"]').click();
			await expect(
				page.locator('.fair-events-get-tickets-callback-processing')
			).toBeVisible({ timeout: 30000 });

			let state = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${email} ${event.eventDateId}`
			);
			expect(state.label).toBe('pending_payment');
			expect(state.over_capacity).toBe(0);

			runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
			const transaction = runScript(
				'transaction-state.php',
				'E2E_TX_STATE',
				String(state.transaction_id)
			);
			const notify = () =>
				page.request.post(
					'/wp-json/fair-payments-connector/v1/webhook',
					{
						form: { id: transaction.mollie_payment_id },
					}
				);
			expect((await notify()).ok()).toBe(true);
			expect((await notify()).ok()).toBe(true);

			state = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${email} ${event.eventDateId}`
			);
			expect(state.label).toBe('signed_up');
			expect(state.over_capacity).toBe(0);
			expect(state.option_ids).toEqual([event.optionIds[0]]);
			expect(state.ledger_count).toBe(1);
		});
	}
});
