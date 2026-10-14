/**
 * E2E: a signed-up participant abandons an add-on checkout, comes back and
 * buys it (#1821).
 *
 * A participant whose add-on checkout was never paid must still be offered
 * the add-on: the unpaid hold is not ownership. The Mollie double's checkout
 * link points straight back at the event page, so "abandoning" is simply
 * returning there while the payment stays open; the later attempt is
 * confirmed through the real webhook route, after which the add-on is no
 * longer offered.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

test.describe('Add-on checkout: abandon and return', () => {
	test.afterEach(() => {
		// Leave the double reporting "paid" for every other spec's assumption.
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
	});

	test('an abandoned add-on stays on offer and can be bought on return', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('unified-with-options', {
			price: 0,
			options: ['dinner'],
			optionPrice: 10,
		});
		const dinnerId = event.optionIds[0];
		const stamp = Date.now();
		const email = `addon.abandon.${stamp}@example.test`;

		// Sign up without the add-on.
		await page.goto(event.pageUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await form.locator('input[name="name"]').fill('Add-on Returner');
		await form.locator('input[name="email"]').fill(email);
		await form.locator('.form-button').click();
		await expect(
			page.getByText('You have successfully registered', {
				exact: false,
			})
		).toBeVisible();

		const addActivities = page.locator('.fair-events-add-activities');
		const dinner = addActivities.locator(
			`input[name="add_option_ids[]"][value="${dinnerId}"]`
		);
		const addButton = addActivities.locator(
			'.fair-events-add-activities-button'
		);

		/**
		 * Choose dinner and start its checkout. The double's checkout link
		 * is the callback URL, which names the created transaction.
		 *
		 * @return {Promise<number>} The add-on transaction ID.
		 */
		async function startDinnerCheckout() {
			await expect(dinner).toBeEnabled();
			await dinner.check();
			await addButton.click();
			await expect(page).toHaveURL(/fair_signup_tx=\d+/);
			return Number(
				new URL(page.url()).searchParams.get('fair_signup_tx')
			);
		}

		// The buyer leaves the checkout without paying.
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'open');
		await page.goto(event.pageUrl);
		const abandoned = await startDinnerCheckout();

		let state = runScript(
			'signup-state.php',
			'E2E_STATE',
			`${email} ${event.eventDateId}`
		);
		expect(state.option_ids).toContain(dinnerId);
		expect(state.confirmed_option_ids).not.toContain(dinnerId);

		// Coming back, the unpaid add-on is still on offer.
		await page.goto(event.pageUrl);
		await expect(dinner).toBeVisible();

		// This time the payment goes through.
		const returned = await startDinnerCheckout();
		expect(returned).not.toBe(abandoned);

		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
		const transaction = runScript(
			'transaction-state.php',
			'E2E_TX_STATE',
			String(returned)
		);
		const webhookResponse = await page.request.post(
			'/wp-json/fair-payments-connector/v1/webhook',
			{ form: { id: transaction.mollie_payment_id } }
		);
		expect(webhookResponse.ok()).toBe(true);

		state = runScript(
			'signup-state.php',
			'E2E_STATE',
			`${email} ${event.eventDateId}`
		);
		expect(state.confirmed_option_ids).toContain(dinnerId);

		// Bought now: no longer offered.
		await page.goto(event.pageUrl);
		await expect(page.locator('.fair-events-get-tickets')).toBeVisible();
		await expect(dinner).toHaveCount(0);
	});
});
