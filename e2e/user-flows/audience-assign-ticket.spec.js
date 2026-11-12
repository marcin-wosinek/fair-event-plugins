/**
 * E2E: an administrator changes the holder of one ticket of a purchase from
 * the Audience tab, and back to its purchaser (#1535, #2133).
 *
 * A visitor buys two tickets. The administrator gives the second one to a
 * participant created in the same step, after reviewing the change: it moves
 * under the new holder, still naming its purchaser, while the purchaser keeps
 * the first, and the ticket details list the change. Giving it back to the
 * purchaser, found by search, returns it, leaves the other person listed
 * without a ticket, and keeps both changes in the history.
 *
 * The List follows the holder (#2133 follow-up): after a change on the
 * Audience tab, the List, after a reload, its printout and its CSV export
 * name the new holder of the given ticket, with its purchaser beside, while
 * the purchaser's other ticket stays theirs.
 */

import { test, expect } from '../support/fixtures.js';
import { loginAsAdmin } from '../support/wp-cli.js';
import { readFile } from 'node:fs/promises';

const escapeRegExp = (text) => text.replace(/[.+]/g, '\\$&');

test.describe('Change a ticket holder from the Audience tab', () => {
	test('gives one ticket to a new participant and back to its purchaser, keeping the history', async ({
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
			.getByRole('button', { name: /^Change holder of Ticket 2/ })
			.click();
		let dialog = page.getByRole('dialog', {
			name: /^Change ticket holder — Ticket 2/,
		});
		// The holder first, then the purchaser: both Paula so far.
		const people = dialog.locator(
			'.fair-audience-assign-ticket__people dd'
		);
		await expect(people).toHaveText([
			`Paula Purchaser (${buyerEmail})`,
			`Paula Purchaser (${buyerEmail})`,
		]);

		await dialog.getByRole('radio', { name: 'A new participant' }).check();
		const review = dialog.getByRole('button', { name: 'Review change' });
		await expect(review).toBeDisabled();
		await dialog.getByLabel('Name', { exact: true }).fill('Gil');
		await dialog.getByLabel('Surname').fill('Guest');
		await expect(review).toBeDisabled();
		await dialog.getByLabel('Email', { exact: true }).fill(guestEmail);
		await review.click();

		// The review names the ticket, both holders and the purchaser.
		await expect(people).toHaveText([
			/^Ticket 2 — /,
			`Paula Purchaser (${buyerEmail})`,
			`Gil Guest (${guestEmail}) — new participant`,
			`Paula Purchaser (${buyerEmail})`,
		]);
		await expect(dialog).toContainText(
			'The payment stays with the purchaser.'
		);
		await dialog
			.getByRole('button', { name: 'Change ticket holder' })
			.click();

		await expect(
			page.getByText('Ticket holder changed to Gil Guest.')
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

		// The ticket details tell the holder from the purchaser and list
		// the change.
		const openDetails = async (holder) => {
			await tickets(holder)
				.filter({ hasText: 'Ticket 2' })
				.getByRole('button', { name: /^Edit Ticket 2/ })
				.click();
			const details = page.getByRole('dialog', {
				name: /^Edit ticket — /,
			});
			await expect(details.getByText('Status:')).toBeVisible();
			return details;
		};
		let details = await openDetails('Gil Guest');
		await expect(
			details.locator('.fair-events-ticket-edit__people dd')
		).toHaveText([
			`Gil Guest (${guestEmail})`,
			`Paula Purchaser (${buyerEmail})`,
		]);
		await expect(
			details.locator('.fair-events-ticket-edit__transfers li')
		).toHaveText([
			new RegExp(
				`from Paula Purchaser \\(${escapeRegExp(buyerEmail)}\\) to Gil Guest \\(${escapeRegExp(guestEmail)}\\), by `
			),
		]);
		await details.getByRole('button', { name: 'Cancel' }).click();
		await expect(details).toBeHidden();

		// Give it back to the purchaser, found by search.
		await tickets('Gil Guest')
			.getByRole('button', { name: /^Change holder of Ticket 2/ })
			.click();
		dialog = page.getByRole('dialog', {
			name: /^Change ticket holder — Ticket 2/,
		});
		await expect(
			dialog.locator('.fair-audience-assign-ticket__people dd')
		).toHaveText([
			`Gil Guest (${guestEmail})`,
			`Paula Purchaser (${buyerEmail})`,
		]);
		await dialog.getByLabel('Search by name or email').fill(buyerEmail);
		const purchaserChoice = dialog.getByRole('radio', {
			name: new RegExp(escapeRegExp(buyerEmail)),
		});
		await expect(purchaserChoice).toHaveCount(1);
		await purchaserChoice.check();
		await dialog.getByRole('button', { name: 'Review change' }).click();
		await dialog
			.getByRole('button', { name: 'Change ticket holder' })
			.click();

		await expect(
			page.getByText('Ticket holder changed to Paula Purchaser.')
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

		// Both changes are kept, and Paula is still the purchaser.
		details = await openDetails('Paula Purchaser');
		await expect(
			details.locator('.fair-events-ticket-edit__people dd')
		).toHaveText([
			`Paula Purchaser (${buyerEmail})`,
			`Paula Purchaser (${buyerEmail})`,
		]);
		await expect(
			details.locator('.fair-events-ticket-edit__transfers li')
		).toHaveText([/to Gil Guest/, /from Gil Guest .* to Paula Purchaser/]);
	});

	test('the List, its printout and its export name the new holder', async ({
		page,
		request,
		seedEvent,
	}) => {
		const event = seedEvent('free', { block: 'get-tickets' });
		const stamp = Date.now();
		const buyerEmail = `list-buyer-${stamp}@example.test`;
		const guestEmail = `list-guest-${stamp}@example.test`;

		const purchase = await request.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: event.eventDateId,
					ticket_type_id: event.ticketTypeId,
					name: 'Lena Purchaser',
					email: buyerEmail,
					quantity: 2,
					_honeypot: '',
				},
			}
		);
		expect(purchase.ok(), await purchase.text()).toBeTruthy();

		await loginAsAdmin(page);
		const manageEvent = `/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${event.eventDateId}`;
		await page.goto(manageEvent);
		await page.getByRole('tab', { name: 'Audience' }).click();
		await page
			.getByRole('button', { name: /^Change holder of Ticket 2/ })
			.click();
		const dialog = page.getByRole('dialog', {
			name: /^Change ticket holder — Ticket 2/,
		});
		await dialog.getByRole('radio', { name: 'A new participant' }).check();
		await dialog.getByLabel('Name', { exact: true }).fill('Theo');
		await dialog.getByLabel('Surname').fill('Holder');
		await dialog.getByLabel('Email', { exact: true }).fill(guestEmail);
		await dialog.getByRole('button', { name: 'Review change' }).click();
		await dialog
			.getByRole('button', { name: 'Change ticket holder' })
			.click();
		await expect(
			page.getByText('Ticket holder changed to Theo Holder.')
		).toBeVisible();

		await page.goto(`${manageEvent}&tab=list`);
		const listRows = page.locator('tr.fair-events-signups__ticket');
		const names = (rows) =>
			rows.evaluateAll((trs) =>
				trs.map((tr) => tr.cells[1].innerText.trim().split('\n'))
			);
		const expected = [
			['Lena Purchaser'],
			['Theo Holder', 'Purchased by Lena Purchaser'],
		];
		await expect(listRows).toHaveCount(2);
		expect(await names(listRows)).toEqual(expected);

		await page.reload();
		await expect(listRows).toHaveCount(2);
		expect(await names(listRows)).toEqual(expected);

		const [popup] = await Promise.all([
			page.waitForEvent('popup'),
			page.getByRole('button', { name: 'Print list' }).click(),
		]);
		await expect(popup.locator('tbody tr')).toHaveCount(2);
		expect(await names(popup.locator('tbody tr'))).toEqual(expected);
		await popup.close();

		await page.getByRole('button', { name: 'Export' }).click();
		const exportDialog = page.getByRole('dialog', { name: 'Export' });
		await exportDialog.getByRole('radio', { name: 'CSV' }).check();
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			exportDialog.getByRole('button', { name: 'Download CSV' }).click(),
		]);
		const csv = (await readFile(await download.path(), 'utf8'))
			.replace(/^\uFEFF/, '')
			.split('\r\n')
			.map((line) => line.split(',').slice(0, 4));
		expect(csv).toEqual([
			[
				'Ticket holder email',
				'Ticket holder',
				'Purchased by',
				'Purchaser email',
			],
			[buyerEmail, 'Lena Purchaser', 'Lena Purchaser', buyerEmail],
			[guestEmail, 'Theo Holder', 'Lena Purchaser', buyerEmail],
		]);
	});
});
