/**
 * E2E: priced add-ons sold by fair-events on its own (#1786).
 *
 * With fair-audience and fair-events-experimental inactive, an organizer
 * configures add-ons on the event's Tickets tab — one with a flat price, one
 * priced per sale period — and a visitor buys a ticket with them. The total
 * the form displays must be the amount the signup and the payment are
 * created with.
 *
 * The whole Playwright run is single-worker/serial, so the plugins turned
 * off here are back on before any other spec runs.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, runScript, loginAsAdmin } from '../support/wp-cli.js';

const OPTIONAL_PLUGINS =
	'fair-audience-experimental fair-audience fair-events-experimental';

/**
 * Read the amount shown as the form's checkout total.
 *
 * @param {import('@playwright/test').Locator} form Signup form.
 * @return {Promise<number>} Displayed total.
 */
async function displayedTotal(form) {
	const text = await form
		.locator('.fair-events-signup-checkout-total-amount')
		.innerText();
	return Number(text.replace(/[^0-9.,]/g, '').replace(',', '.'));
}

/**
 * Open the event's Tickets tab and its Add-ons panel.
 *
 * @param {import('@playwright/test').Page} page        Playwright page.
 * @param {number}                          eventDateId Event date ID.
 */
async function openAddons(page, eventDateId) {
	await page.goto(
		`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${eventDateId}&tab=tickets`
	);
	await page.getByRole('button', { name: 'Add-ons', exact: true }).click();
}

/**
 * Buy one ticket with every offered add-on selected and return the total
 * the form displayed just before submitting.
 *
 * @param {import('@playwright/test').Page} page  Playwright page.
 * @param {Object}                          event Seeded event.
 * @param {string}                          email Buyer email.
 * @return {Promise<number>} Displayed total.
 */
async function buyWithAddons(page, event, email) {
	await page.goto(event.pageUrl);

	const form = page.locator('.fair-events-get-tickets-form');
	await expect(form).toBeVisible();
	await form.locator('input[name="name"]').fill('Add-on Buyer');
	await form.locator('input[name="email"]').fill(email);
	await form
		.locator(`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`)
		.check();
	for (const checkbox of await form
		.locator('input[name="ticket_option_ids[]"]')
		.all()) {
		await checkbox.check();
	}

	const total = await displayedTotal(form);

	await form.locator('button[type="submit"]').click();
	await expect(
		page.locator('.fair-events-get-tickets-callback-processing')
	).toBeVisible({ timeout: 30000 });

	return total;
}

test.describe('Add-ons sold by fair-events alone', () => {
	test.beforeAll(() => {
		wpCli(`plugin deactivate ${OPTIONAL_PLUGINS}`);
	});

	test.afterAll(() => {
		wpCli(
			'plugin activate fair-events-experimental fair-audience fair-audience-experimental'
		);
	});

	test.beforeEach(() => {
		// Keep the payment in flight so the callback page shows it processing.
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'pending');
	});

	test.afterEach(() => {
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
	});

	test('a flat-priced add-on is configured, shown and charged', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('unified-with-options', {
			price: 20,
			options: [],
		});

		await loginAsAdmin(page);
		await openAddons(page, event.eventDateId);
		await page.getByRole('button', { name: '+ Add Option' }).click();
		const row = page.locator('tr', {
			has: page.getByPlaceholder('Add-on name'),
		});
		await row.getByPlaceholder('Add-on name').fill('Dinner');
		await row.locator('input[type="number"]').first().fill('12.5');
		await page.getByRole('button', { name: 'Save tickets' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Tickets saved successfully.')
		).toBeVisible();

		const email = `addon.flat.${Date.now()}@example.test`;
		const total = await buyWithAddons(page, event, email);
		expect(total).toBe(32.5);

		const state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		expect(state.signups).toHaveLength(1);
		expect(state.signups[0].email).toBe(email);
		expect(state.signups[0].status).toBe('pending_payment');
		expect(state.signups[0].amount).toBe(total);
		expect(Number(state.mollie_payload.amount.value)).toBe(total);
	});

	test('an add-on priced per sale period is charged at the price on sale', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('unified-with-options', {
			price: 20,
			options: [],
		});

		await loginAsAdmin(page);
		await openAddons(page, event.eventDateId);
		await page
			.getByRole('button', { name: 'More options', exact: true })
			.click();
		await page
			.getByRole('checkbox', { name: 'Price add-ons per sale period' })
			.check();
		await page.getByRole('button', { name: '+ Add Option' }).click();
		const row = page.locator('tr', {
			has: page.getByPlaceholder('Add-on name'),
		});
		await row.getByPlaceholder('Add-on name').fill('Workshop');
		// One price input per sale period; the seeded event has one period.
		await row.locator('input[type="number"]').first().fill('7.25');
		await page.getByRole('button', { name: 'Save tickets' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Tickets saved successfully.')
		).toBeVisible();

		const email = `addon.period.${Date.now()}@example.test`;
		const total = await buyWithAddons(page, event, email);
		expect(total).toBe(27.25);

		const state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		expect(state.signups).toHaveLength(1);
		expect(state.signups[0].amount).toBe(total);
		expect(Number(state.mollie_payload.amount.value)).toBe(total);
	});

	test('an add-on without a price for the period on sale is not offered', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('unified-with-options', {
			price: 20,
			options: [],
		});

		await loginAsAdmin(page);
		await openAddons(page, event.eventDateId);
		await page
			.getByRole('button', { name: 'More options', exact: true })
			.click();
		await page
			.getByRole('checkbox', { name: 'Price add-ons per sale period' })
			.check();
		await page.getByRole('button', { name: '+ Add Option' }).click();
		// Named, but its price for the period on sale is left blank.
		await page.getByPlaceholder('Add-on name').fill('Unpriced');
		await page.getByRole('button', { name: 'Save tickets' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Tickets saved successfully.')
		).toBeVisible();

		await page.goto(event.pageUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await expect(
			form.locator('input[name="ticket_option_ids[]"]')
		).toHaveCount(0);
		expect(await displayedTotal(form)).toBe(20);
	});
});
