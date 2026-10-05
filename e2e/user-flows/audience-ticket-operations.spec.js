/**
 * E2E: an administrator manages the individual tickets of one purchase from
 * the Audience tab (#1699).
 *
 * A visitor buys two tickets with one email. The administrator assigns the
 * second to someone else, tells the two apart by search and in the tickets
 * CSV, moves the first to another date of the series, then cancels and
 * deletes the second. Each step changes only the ticket it names, and nobody
 * is removed from the audience.
 */

import { test, expect } from '../support/fixtures.js';
import { loginAsAdmin } from '../support/wp-cli.js';

test.describe('Manage individual tickets from the Audience tab', () => {
	test('assigns, finds, exports, moves, cancels and deletes single tickets', async ({
		page,
		request,
		seedEvent,
	}) => {
		const event = seedEvent('three-ticket-scopes', {
			price: 0,
			block: 'get-tickets',
		});
		const otherDateId = event.occurrenceIds.find(
			(id) => id !== event.eventDateId
		);
		const stamp = Date.now();
		const buyerEmail = `ops-buyer-${stamp}@example.test`;
		const guestEmail = `ops-guest-${stamp}@example.test`;

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

		const openAudience = async (eventDateId) => {
			await page.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${eventDateId}`
			);
			await page.getByRole('tab', { name: 'Audience' }).click();
			await expect(
				page.locator('.fair-audience-audience-table')
			).toBeVisible();
		};
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
		const role = (name) =>
			group(name).locator(
				'tr.fair-audience-audience-table__participant td[data-colname="Role"]'
			);
		const allTickets = page.locator(
			'tr.fair-audience-audience-table__ticket'
		);
		const search = page.getByLabel('Search', { exact: true });

		await loginAsAdmin(page);
		await openAudience(event.eventDateId);
		await expect(tickets('Paula Purchaser')).toHaveCount(2);

		// Assignment: the second ticket goes to someone new.
		await tickets('Paula Purchaser')
			.nth(1)
			.getByRole('button', { name: /^Assign Ticket 2/ })
			.click();
		let dialog = page.getByRole('dialog', {
			name: /^Assign ticket — Ticket 2/,
		});
		await dialog.getByRole('radio', { name: 'A new participant' }).check();
		await dialog.getByLabel('Name', { exact: true }).fill('Gil');
		await dialog.getByLabel('Surname').fill('Guest');
		await dialog.getByLabel('Email (optional)').fill(guestEmail);
		await dialog.getByRole('button', { name: 'Assign ticket' }).click();
		await expect(
			page.getByText('Ticket assigned to Gil Guest.')
		).toBeVisible();
		await expect(tickets('Gil Guest')).toHaveCount(1);
		await expect(tickets('Paula Purchaser')).toHaveCount(1);

		// Search: two tickets bought with one email are told apart.
		await search.fill(buyerEmail);
		await expect(allTickets).toHaveCount(2);
		await search.fill(guestEmail);
		await expect(allTickets).toHaveCount(1);
		await expect(tickets('Gil Guest')).toHaveCount(1);
		await expect(group('Paula Purchaser')).toHaveCount(0);
		const guestReference = (await tickets('Gil Guest').innerText()).match(
			/Ticket 2 \(([0-9A-F]{8})\)/
		)[1];
		await search.fill(guestReference.toLowerCase());
		await expect(allTickets).toHaveCount(1);
		await expect(tickets('Gil Guest')).toHaveCount(1);

		// The export contains what the search shows: one row per ticket.
		const readExport = async () => {
			const [download] = await Promise.all([
				page.waitForEvent('download'),
				page
					.getByRole('button', { name: 'Export tickets CSV' })
					.click(),
			]);
			const chunks = [];
			for await (const chunk of await download.createReadStream()) {
				chunks.push(chunk);
			}
			return Buffer.concat(chunks)
				.toString('utf8')
				.replace('﻿', '')
				.split('\r\n');
		};
		let csv = await readExport();
		expect(csv).toHaveLength(2);
		expect(csv[1]).toContain(`"${guestReference}"`);
		expect(csv[1]).toContain(`"Paula Purchaser","${buyerEmail}"`);
		expect(csv[1]).toContain(`"Gil Guest","${guestEmail}"`);

		await search.fill('');
		await expect(allTickets).toHaveCount(2);
		csv = await readExport();
		expect(csv).toHaveLength(3);
		// Both rows name the same purchaser, and different assignees.
		expect(
			csv.slice(1).filter((line) => line.includes(`"${buyerEmail}"`))
		).toHaveLength(2);
		expect(
			csv.slice(1).filter((line) => line.includes(`"${guestEmail}"`))
		).toHaveLength(1);

		// Move: the purchaser's own ticket goes to another date.
		await tickets('Paula Purchaser')
			.getByRole('button', { name: /^Move Ticket 1/ })
			.click();
		dialog = page.getByRole('dialog', { name: /^Move ticket — Ticket 1/ });
		await expect(dialog).toContainText('Only this ticket moves.');
		await expect(dialog).toContainText('nothing is charged or refunded');
		await dialog
			.getByLabel('Move to date')
			.selectOption(String(otherDateId));
		await dialog.getByRole('button', { name: 'Move ticket' }).click();
		await expect(page.getByText(/^Ticket moved to /)).toBeVisible();
		await expect(dialog).toBeHidden();
		// The sibling ticket stays, with its holder; the purchaser stays
		// listed for the purchase.
		await expect(tickets('Gil Guest')).toHaveCount(1);
		await expect(tickets('Paula Purchaser')).toHaveCount(0);
		await expect(role('Paula Purchaser')).toHaveText('Purchaser');

		await openAudience(otherDateId);
		await expect(tickets('Paula Purchaser')).toHaveCount(1);
		await expect(tickets('Paula Purchaser')).toContainText('Ticket 1');
		await expect(role('Paula Purchaser')).toHaveText('Signed up');
		await expect(group('Gil Guest')).toHaveCount(0);

		// Cancel: the payment consequence is stated before anything changes.
		await openAudience(event.eventDateId);
		await tickets('Gil Guest')
			.getByRole('button', { name: /^Cancel Ticket 2/ })
			.click();
		dialog = page.getByRole('dialog', {
			name: /^Cancel ticket — Ticket 2/,
		});
		await expect(
			dialog.locator('.fair-audience-assign-ticket__people dd')
		).toHaveText([
			`Paula Purchaser (${buyerEmail})`,
			`Gil Guest (${guestEmail})`,
		]);
		await expect(dialog).toContainText(
			'Cancelling does not refund anything.'
		);
		await dialog.getByRole('button', { name: 'Cancel ticket' }).click();
		await expect(
			page.getByText('Ticket cancelled. No refund was issued.')
		).toBeVisible();
		await expect(tickets('Gil Guest')).toHaveCount(1);
		await expect(tickets('Gil Guest')).toContainText('Cancelled');
		await expect(tickets('Gil Guest').getByRole('button')).toHaveText([
			'Delete ticket',
		]);
		await expect(role('Gil Guest')).toHaveText('Interested');

		// The moved ticket on the other date is not affected.
		await openAudience(otherDateId);
		await expect(tickets('Paula Purchaser')).toHaveCount(1);
		await expect(tickets('Paula Purchaser')).toContainText('Confirmed');

		// Delete: the cancelled ticket leaves the list; its holder stays.
		await openAudience(event.eventDateId);
		await tickets('Gil Guest')
			.getByRole('button', { name: /^Delete Ticket 2/ })
			.click();
		dialog = page.getByRole('dialog', {
			name: /^Delete ticket — Ticket 2/,
		});
		await expect(dialog).toContainText(
			'Deleting does not refund anything and does not change the payment.'
		);
		await dialog.getByRole('button', { name: 'Delete ticket' }).click();
		await expect(page.getByText('Ticket deleted.')).toBeVisible();
		await expect(allTickets).toHaveCount(0);
		await expect(group('Gil Guest')).toHaveCount(1);
		await expect(group('Paula Purchaser')).toHaveCount(1);
		await expect(
			page.getByRole('button', { name: 'Export tickets CSV' })
		).toBeDisabled();
	});
});
