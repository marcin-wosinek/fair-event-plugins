/**
 * E2E: a purchase awaiting payment stays out of the List, and is told apart
 * in the Audience tab, until its payment succeeds (#1754).
 *
 * A visitor submits the public form for a paid ticket while the Mollie
 * double still reports the payment as open. The administrator sees nobody
 * in the List and a "Payment in progress" participant in the Audience tab,
 * and saving a comment for them leaves that as it is. Once Mollie's webhook
 * reports the payment paid, the visitor's ticket is in the List and they are
 * signed up.
 */

import { test, expect } from '../support/fixtures.js';
import { loginAsAdmin, runScript } from '../support/wp-cli.js';

test.describe('Purchases awaiting payment in the List and Audience tabs', () => {
	test.afterEach(() => {
		// Leave the double reporting "paid" for every other spec's assumption.
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
	});

	test('lists the buyer only once their payment succeeds', async ({
		page,
		browser,
		seedEvent,
	}) => {
		const event = seedEvent('paid-with-options', {
			block: 'get-tickets',
			options: ['dinner'],
		});
		const stamp = Date.now();
		const buyerName = `Unfinished Buyer ${stamp}`;
		const email = `unfinished.buyer.${stamp}@example.test`;

		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'open');

		// The visitor starts paying and lands back on the event page with
		// the payment still open.
		await page.goto(event.pageUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await form.locator('input[name="name"]').fill(buyerName);
		await form.locator('input[name="email"]').fill(email);
		await form
			.locator(
				`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
			)
			.check();
		await form.locator('button[type="submit"]').click();
		await expect(
			page.locator('.fair-events-get-tickets-callback')
		).toBeVisible({ timeout: 30000 });
		await expect(page).toHaveURL(/fair_payment_callback=true/);

		// The administrator works in a browser of their own.
		const adminContext = await browser.newContext();
		const admin = await adminContext.newPage();
		await loginAsAdmin(admin);

		const openTab = async (name) => {
			await admin.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${event.eventDateId}`
			);
			await admin.getByRole('tab', { name, exact: true }).click();
		};
		const audienceRow = admin.locator(
			'tr.fair-audience-audience-table__participant',
			{ hasText: buyerName }
		);
		const role = audienceRow.locator('td[data-colname="Role"]');

		await openTab('List');
		await expect(
			admin.getByText('No confirmed registrations yet.')
		).toBeVisible();
		await expect(admin.getByText(buyerName)).toHaveCount(0);
		await expect(
			admin
				.locator('.fair-events-signups')
				.getByRole('button', { name: 'Export' })
		).toBeDisabled();

		await openTab('Audience');
		await expect(role).toHaveText('Payment in progress');
		await expect(admin.getByText('Unfinished purchases:')).toBeVisible();

		// Saving a comment leaves the payment state as it is.
		await audienceRow
			.getByRole('button', { name: 'Edit participant' })
			.click();
		const dialog = admin.getByRole('dialog');
		await expect(dialog.getByLabel('Role')).toHaveValue('pending_payment');
		await dialog.locator('textarea').first().fill('Asked about parking');
		await dialog
			.getByRole('button', { name: /^Save( participant)?$/ })
			.click();
		await expect(dialog).toHaveCount(0);
		await expect(role).toHaveText('Payment in progress');

		await openTab('Audience');
		await expect(role).toHaveText('Payment in progress');
		await openTab('List');
		await expect(
			admin.getByText('No confirmed registrations yet.')
		).toBeVisible();

		// The buyer's bank confirms the payment: Mollie's webhook fetches it
		// from the double, now reporting paid. Back on the page, the buyer
		// finds the purchase confirmed.
		const state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		expect(state.signups[0].status).toBe('pending_payment');
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
		const webhookResponse = await page.request.post(
			'/wp-json/fair-payments-connector/v1/webhook',
			{ form: { id: state.signups[0].mollie_payment_id } }
		);
		expect(webhookResponse.ok()).toBe(true);
		await page.reload();
		await expect(
			page.locator('.fair-events-get-tickets-callback-confirmed')
		).toBeVisible({ timeout: 30000 });

		await openTab('List');
		const listRow = admin.locator('tr.fair-events-signups__ticket', {
			hasText: buyerName,
		});
		await expect(listRow).toHaveCount(1);
		await expect(listRow).toContainText('Confirmed');

		await openTab('Audience');
		await expect(role).toHaveText('Signed up');
		await expect(admin.getByText('Unfinished purchases:')).toHaveCount(0);

		await adminContext.close();
	});
});
