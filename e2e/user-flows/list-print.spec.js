/**
 * E2E: an organizer prints the List of an event date (#1842).
 *
 * Three visitors register: one for two tickets with a mailing opt-in, one for
 * a single ticket without, and one who opts in and later declines mailings in
 * Fair Audience. The administrator narrows the List to mailing opt-ins and
 * prints: the preview window names the event and its date and holds every
 * ticket of the complete List, in the List's order, without the List's
 * controls, each with its short reference and the participant's current
 * mailing consent as a mark. It stays available when the filter matches
 * nobody.
 */

import { test, expect } from '../support/fixtures.js';
import { ADMIN_PASSWORD, ADMIN_USER, loginAsAdmin } from '../support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('Print the List of an event date', () => {
	test('prints the complete List whatever the screen filter shows', async ({
		page,
		request,
		playwright,
		baseURL,
		seedEvent,
	}) => {
		const event = seedEvent('free', { block: 'get-tickets' });
		const stamp = Date.now();

		// Each visitor registers from a browser session of their own.
		const register = async (name, data) => {
			const visitor = await playwright.request.newContext({ baseURL });
			const response = await visitor.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: event.eventDateId,
						ticket_type_id: event.ticketTypeId,
						name,
						_honeypot: '',
						...data,
					},
				}
			);
			expect(response.ok(), await response.text()).toBeTruthy();
			await visitor.dispose();
		};
		await register('Olga Optin', {
			email: `print-optin-${stamp}@example.test`,
			quantity: 2,
			mailing_opt_in: true,
		});
		await register('Nico Nomail', {
			email: `print-nomail-${stamp}@example.test`,
			quantity: 1,
			mailing_opt_in: false,
		});
		await register('Dora Declined', {
			email: `print-declined-${stamp}@example.test`,
			quantity: 1,
			mailing_opt_in: true,
		});

		// What each participant consents to now, in Fair Audience: Dora
		// declined mailings after registering with an opt-in.
		const signupsResponse = await request.get(
			`/wp-json/fair-events/v1/get-tickets?event_date=${event.eventDateId}`,
			{ headers: adminHeaders }
		);
		expect(signupsResponse.ok()).toBeTruthy();
		const signups = await signupsResponse.json();
		const setProfile = async (name, emailProfile) => {
			const signup = signups.find((item) => item.name === name);
			expect(signup?.participant_id).toBeTruthy();
			const path = `/wp-json/fair-audience/v1/participants/${signup.participant_id}`;
			const participant = await (
				await request.get(path, { headers: adminHeaders })
			).json();
			const response = await request.put(path, {
				headers: adminHeaders,
				data: {
					name: participant.name,
					surname: participant.surname,
					email: participant.email,
					email_profile: emailProfile,
				},
			});
			expect(response.ok(), await response.text()).toBeTruthy();
		};
		await setProfile('Olga Optin', 'marketing');
		await setProfile('Nico Nomail', 'minimal');
		await setProfile('Dora Declined', 'declined');

		await loginAsAdmin(page);
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${event.eventDateId}&tab=list`
		);
		const listRows = page.locator('tr.fair-events-signups__ticket');
		await expect(listRows).toHaveCount(4);
		await expect(page.locator('.fair-events-signups thead th')).toHaveText([
			'#',
			'Name',
			'Ticket',
			'Ticket Type',
			'Status',
			'Mailing',
			'Actions',
		]);
		const dataCells = (rows) =>
			rows.evaluateAll((trs) =>
				trs.map((tr) =>
					Array.from(tr.cells)
						.slice(0, 4)
						.map((cell) => cell.textContent.trim())
				)
			);
		const completeList = await dataCells(listRows);
		const pageTitle = await page
			.locator('h1')
			.first()
			.innerText()
			.then((text) => text.replace(/^Manage Event:\s*/, ''));

		const printButton = page.getByRole('button', { name: 'Print list' });
		const print = async () => {
			const [popup] = await Promise.all([
				page.waitForEvent('popup'),
				printButton.click(),
			]);
			await expect(popup.locator('table')).toBeVisible();
			return popup;
		};

		// The mailing filter narrows the screen, not the printout. It follows
		// the opt-in each registration recorded, as the screen's Yes/No does.
		await page.getByLabel('Mailing opt-ins only').check();
		await expect(listRows).toHaveCount(3);
		await expect(listRows.filter({ hasText: 'Nico Nomail' })).toHaveCount(
			0
		);
		await expect(
			listRows.filter({ hasText: 'Dora Declined' }).locator('td').nth(5)
		).toHaveText('Yes');

		let popup = await print();
		await expect(popup.locator('h1')).toHaveText(pageTitle);
		await expect(popup.locator('header .meta')).toContainText(
			/\d{4}.*· List · 4 tickets$/
		);
		expect(await dataCells(popup.locator('tbody tr'))).toEqual(
			completeList
		);
		await expect(popup.locator('thead th')).toHaveText([
			'#',
			'Name',
			'Ticket',
			'Ticket Type',
			'Status',
			'Mailing',
		]);
		// One section: nothing is left over for a second part of the table.
		await expect(popup.locator('table')).toHaveCount(1);
		await expect(popup.locator('tbody td.col-ticket')).toHaveText(
			Array(4).fill(/^[0-9A-F]{8}$/)
		);
		// Current consent as a mark: granted, unspecified, declined.
		const printedMailing = await popup
			.locator('tbody tr')
			.evaluateAll((trs) =>
				trs.map((tr) => [
					tr.cells[1].textContent.trim(),
					tr.cells[5].textContent.trim(),
				])
			);
		expect(Object.fromEntries(printedMailing)).toEqual({
			'Olga Optin': '✓',
			'Nico Nomail': '',
			'Dora Declined': '✗',
		});
		// Nothing interactive is printed, and no email address.
		await expect(popup.getByRole('button')).toHaveText(['Print']);
		await expect(popup.locator('a')).toHaveCount(0);
		await expect(popup.locator('body')).not.toContainText('@example.test');
		await expect(popup.locator('body')).not.toContainText('Delete');
		await popup.emulateMedia({ media: 'print' });
		await expect(popup.getByRole('button', { name: 'Print' })).toBeHidden();
		await popup.close();

		// A filter matching nobody still leaves the complete List to print.
		await page.getByLabel('Mailing opt-ins only').uncheck();
		await expect(listRows).toHaveCount(4);
		for (const [name, remaining] of [
			['Olga Optin', 2],
			['Dora Declined', 1],
		]) {
			await listRows
				.filter({ hasText: name })
				.first()
				.getByRole('button', { name: 'Delete' })
				.click();
			await page
				.getByRole('button', { name: 'Delete registration' })
				.click();
			await expect(listRows).toHaveCount(remaining);
		}
		await page.getByLabel('Mailing opt-ins only').check();
		await expect(listRows).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Export' })
		).toBeDisabled();
		await expect(printButton).toBeEnabled();

		popup = await print();
		await expect(popup.locator('tbody tr')).toHaveCount(1);
		await expect(popup.locator('tbody tr')).toContainText('Nico Nomail');
		await expect(popup.locator('header .meta')).toContainText(
			'List · 1 ticket'
		);
		await popup.close();
	});
});
