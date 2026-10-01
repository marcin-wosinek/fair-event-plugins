/**
 * E2E: an administrator assigns one ticket of a purchase to someone else from
 * the Audience tab, and back to its purchaser (#1535).
 *
 * A visitor buys two tickets. The administrator gives the second one to a
 * participant created in the same step: it moves under the new holder, still
 * naming its purchaser, while the purchaser keeps the first. Assigning it back
 * to the purchaser, found by search, returns it and leaves the other person
 * listed without a ticket.
 */

import { test, expect } from '../support/fixtures.js';
import { loginAsAdmin } from '../support/wp-cli.js';

test.describe('Assign a ticket from the Audience tab', () => {
	test('gives one ticket to a new participant and back to its purchaser', async ({
		page,
		request,
		seedEvent,
	}) => {
		const event = seedEvent('free', { block: 'get-tickets' });
		const stamp = Date.now();
		const buyerEmail = `assign-buyer-${stamp}@example.test`;
		const guestEmail = `assign-guest-${stamp}@example.test`;

		const purchase = await request.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: event.eventDateId,
					ticket_type_id: event.ticketTypeId,
					name: 'Paula Purchaser',
					email: buyerEmail,
					quantity: 2,
					_honeypot: '',
				},
			}
		);
		expect(purchase.ok(), await purchase.text()).toBeTruthy();

		await loginAsAdmin(page);
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${event.eventDateId}`
		);
		await page.getByRole('tab', { name: 'Audience' }).click();

		// Each participant is a group: their own row, then their tickets.
		const group = (name) =>
			page.locator('.fair-audience-audience-table tbody', {
				has: page.locator(
					'tr.fair-audience-audience-table__participant',
					{ hasText: name }
				),
			});
		const tickets = (name) =>
			group(name).locator('tr.fair-audience-audience-table__ticket');

		await expect(tickets('Paula Purchaser')).toHaveCount(2);

		// Give the second ticket to someone new.
		await tickets('Paula Purchaser')
			.nth(1)
			.getByRole('button', { name: /^Assign Ticket 2/ })
			.click();
		let dialog = page.getByRole('dialog', {
			name: /^Assign ticket — Ticket 2/,
		});
		// Purchaser first, then the current assignee: still the purchaser.
		const people = dialog.locator(
			'.fair-audience-assign-ticket__people dd'
		);
		await expect(people).toHaveText([
			`Paula Purchaser (${buyerEmail})`,
			`Paula Purchaser (${buyerEmail})`,
		]);

		await dialog.getByRole('radio', { name: 'A new participant' }).check();
		await expect(
			dialog.getByRole('button', { name: 'Assign ticket' })
		).toBeDisabled();
		await dialog.getByLabel('Name', { exact: true }).fill('Gil');
		await dialog.getByLabel('Surname').fill('Guest');
		await dialog.getByLabel('Email (optional)').fill(guestEmail);
		await dialog.getByRole('button', { name: 'Assign ticket' }).click();

		await expect(
			page.getByText('Ticket assigned to Gil Guest.')
		).toBeVisible();
		await expect(dialog).toBeHidden();
		await expect(tickets('Gil Guest')).toHaveCount(1);
		await expect(tickets('Gil Guest')).toContainText(
			`Purchased by Paula Purchaser (${buyerEmail})`
		);
		await expect(
			group('Gil Guest').locator(
				'tr.fair-audience-audience-table__participant'
			)
		).toContainText('Signed up');
		await expect(tickets('Paula Purchaser')).toHaveCount(1);
		await expect(group('Paula Purchaser')).toContainText(
			'1 ticket assigned to someone else'
		);

		// Give it back to the purchaser, found by search.
		await tickets('Gil Guest')
			.getByRole('button', { name: /^Assign Ticket 2/ })
			.click();
		dialog = page.getByRole('dialog', {
			name: /^Assign ticket — Ticket 2/,
		});
		await expect(
			dialog.locator('.fair-audience-assign-ticket__people dd')
		).toHaveText([
			`Paula Purchaser (${buyerEmail})`,
			`Gil Guest (${guestEmail})`,
		]);
		await dialog.getByLabel('Search by name or email').fill(buyerEmail);
		const purchaserChoice = dialog.getByRole('radio', {
			name: new RegExp(buyerEmail.replace(/[.+]/g, '\\$&')),
		});
		await expect(purchaserChoice).toHaveCount(1);
		await purchaserChoice.check();
		await dialog.getByRole('button', { name: 'Assign ticket' }).click();

		await expect(
			page.getByText('Ticket assigned to Paula Purchaser.')
		).toBeVisible();
		await expect(tickets('Paula Purchaser')).toHaveCount(2);
		await expect(group('Paula Purchaser')).not.toContainText(
			'assigned to someone else'
		);
		// The other person stays listed, without a ticket.
		await expect(tickets('Gil Guest')).toHaveCount(0);
		await expect(
			group('Gil Guest').locator(
				'tr.fair-audience-audience-table__participant'
			)
		).toContainText('Interested');
	});
});
