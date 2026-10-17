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
 *
 * Test-mode purchases (#1866): a visitor pays for two tickets through the
 * Mollie double in test mode, another buyer's payment is recorded live, and
 * a third never completes payment. The List and its printout keep both test
 * tickets with a "Test payment" warning each, leave the live ticket
 * unmarked and the unfinished purchase out, and switching the integration to
 * live mode does not change that.
 *
 * Summary with test purchases (#1839): one event holds confirmed live and
 * free registrations, a confirmed two-ticket test purchase with add-ons, and
 * pending, failed, expired and cancelled purchases. The copied summary counts
 * the live and free tickets as operational totals and the test tickets in
 * their own section, ignores the unsuccessful purchases, and stays the same
 * in either integration mode, while the List and its printout keep their
 * test-payment warnings.
 */

import { test, expect } from '../support/fixtures.js';
import {
	ADMIN_PASSWORD,
	ADMIN_USER,
	loginAsAdmin,
	runScript,
} from '../support/wp-cli.js';

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

	test('lists and prints confirmed test-payment tickets with a warning on each', async ({
		page,
		request,
		playwright,
		baseURL,
		seedEvent,
	}) => {
		const event = seedEvent('paid', { block: 'get-tickets' });
		const stamp = Date.now();
		const emails = {
			test: `print-test-payment-${stamp}@example.test`,
			live: `print-live-payment-${stamp}@example.test`,
			pending: `print-pending-payment-${stamp}@example.test`,
		};

		const buy = async (name, email, quantity) => {
			const visitor = await playwright.request.newContext({ baseURL });
			const response = await visitor.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						event_date_id: event.eventDateId,
						ticket_type_id: event.ticketTypeId,
						name,
						email,
						quantity,
						_honeypot: '',
					},
				}
			);
			expect(response.ok(), await response.text()).toBeTruthy();
			await visitor.dispose();
		};
		await buy('Tess Tester', emails.test, 2);
		await buy('Liv Live', emails.live, 1);
		await buy('Penny Pending', emails.pending, 1);

		const state = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(event.eventDateId)
		);
		const signupOf = (email) =>
			state.signups.find((signup) => signup.email === email);

		// Tess pays through the Mollie double, in the test mode this site
		// runs in: its webhook confirms the purchase.
		const webhook = await request.post(
			'/wp-json/fair-payments-connector/v1/webhook',
			{ form: { id: signupOf(emails.test).mollie_payment_id } }
		);
		expect(webhook.ok()).toBe(true);
		expect(
			runScript(
				'get-tickets-state.php',
				'E2E_GT_STATE',
				String(event.eventDateId)
			).signups.find((signup) => signup.email === emails.test)
		).toMatchObject({
			status: 'confirmed',
			transaction_testmode: true,
		});

		// Liv's payment was recorded live.
		const transaction = await request.post(
			'/wp-json/fair-e2e/v1/test-transactions',
			{
				headers: adminHeaders,
				data: {
					event_date_id: event.eventDateId,
					amount: event.price,
					status: 'paid',
					testmode: false,
				},
			}
		);
		expect(transaction.ok()).toBeTruthy();
		const linked = await request.post(
			'/wp-json/fair-e2e/v1/signup-transaction',
			{
				headers: adminHeaders,
				data: {
					signup_id: signupOf(emails.live).id,
					transaction_id: (await transaction.json()).id,
					status: 'confirmed',
				},
			}
		);
		expect(linked.ok()).toBeTruthy();

		const setMode = async (mode) => {
			const response = await request.post(
				'/wp-json/fair-e2e/v1/payment-mode',
				{ headers: adminHeaders, data: { mode } }
			);
			expect(response.ok()).toBeTruthy();
		};

		await loginAsAdmin(page);
		const listUrl = `/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${event.eventDateId}&tab=list`;
		const listRows = page.locator('tr.fair-events-signups__ticket');
		const ticketCells = (rows) =>
			rows.evaluateAll((trs) =>
				trs.map((tr) => [
					tr.cells[1].textContent.trim(),
					tr.cells[2].textContent.trim(),
				])
			);
		const expectMarked = async (rows) => {
			const cells = await ticketCells(rows);
			expect(cells).toHaveLength(3);
			expect(cells.map(([name]) => name).sort()).toEqual([
				'Liv Live',
				'Tess Tester',
				'Tess Tester',
			]);
			for (const [name, ticket] of cells) {
				expect(ticket).toMatch(
					name === 'Tess Tester'
						? /^[0-9A-F]{8}\s*Test payment$/
						: /^[0-9A-F]{8}$/
				);
			}
		};

		try {
			for (const mode of ['test', 'live']) {
				await setMode(mode);
				await page.goto(listUrl);
				await expect(listRows).toHaveCount(3);
				await expect(
					listRows.filter({ hasText: 'Penny Pending' })
				).toHaveCount(0);
				await expectMarked(listRows);
				await expect(
					listRows.locator('.fair-events-signups__test-payment')
				).toHaveCount(2);
				await expect(
					listRows.filter({ hasText: 'Tess Tester' }).first()
				).toContainText('Confirmed');
			}

			const [popup] = await Promise.all([
				page.waitForEvent('popup'),
				page.getByRole('button', { name: 'Print list' }).click(),
			]);
			await expect(popup.locator('table')).toBeVisible();
			await expectMarked(popup.locator('tbody tr'));
			await expect(popup.locator('tbody .test-warning')).toHaveText([
				'Test payment',
				'Test payment',
			]);
			await expect(popup.locator('body')).not.toContainText(
				'Penny Pending'
			);
			// Readable in black and white: bold and bordered, on no background.
			await popup.emulateMedia({ media: 'print' });
			const warningStyle = await popup
				.locator('tbody .test-warning')
				.first()
				.evaluate((el) => {
					const style = window.getComputedStyle(el);
					return {
						fontWeight: style.fontWeight,
						borderStyle: style.borderTopStyle,
						background: style.backgroundColor,
					};
				});
			expect(Number(warningStyle.fontWeight)).toBeGreaterThanOrEqual(700);
			expect(warningStyle.borderStyle).toBe('solid');
			expect(warningStyle.background).toBe('rgba(0, 0, 0, 0)');
			await popup.close();
		} finally {
			await setMode('test');
		}
	});

	test.describe('with clipboard access', () => {
		test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

		test('summarises live and free tickets apart from test purchases, whatever the integration mode', async ({
			page,
			request,
			playwright,
			baseURL,
			seedEvent,
		}) => {
			const event = seedEvent('paid-with-options', {
				block: 'get-tickets',
				options: ['Yoga', 'Tai Chi'],
			});
			const [yoga, taiChi] = event.optionIds;
			const stamp = Date.now();
			const emailOf = (key) => `summary-${key}-${stamp}@example.test`;

			const buy = async (name, key, ticketActivities) => {
				const visitor = await playwright.request.newContext({
					baseURL,
				});
				const response = await visitor.post(
					'/wp-json/fair-events/v1/get-tickets',
					{
						data: {
							event_date_id: event.eventDateId,
							ticket_type_id: event.ticketTypeId,
							name,
							email: emailOf(key),
							quantity: ticketActivities.length,
							ticket_activities: ticketActivities,
							_honeypot: '',
						},
					}
				);
				expect(response.ok(), await response.text()).toBeTruthy();
				await visitor.dispose();
			};
			await buy('Tess Tester', 'test', [[yoga], [yoga, taiChi]]);
			await buy('Liv Live', 'live', [[taiChi]]);
			await buy('Fran Free', 'free', [[yoga]]);
			for (const status of [
				'pending',
				'failed',
				'expired',
				'cancelled',
			]) {
				await buy(`Unsuccessful ${status}`, status, [[yoga, taiChi]]);
			}

			const signupOf = (key) =>
				runScript(
					'get-tickets-state.php',
					'E2E_GT_STATE',
					String(event.eventDateId)
				).signups.find((signup) => signup.email === emailOf(key));
			const setSignupTransaction = async (key, transactionId, status) => {
				const response = await request.post(
					'/wp-json/fair-e2e/v1/signup-transaction',
					{
						headers: adminHeaders,
						data: {
							signup_id: signupOf(key).id,
							transaction_id: transactionId,
							status,
						},
					}
				);
				expect(response.ok()).toBeTruthy();
			};

			// Tess pays through the Mollie double in test mode.
			const webhook = await request.post(
				'/wp-json/fair-payments-connector/v1/webhook',
				{ form: { id: signupOf('test').mollie_payment_id } }
			);
			expect(webhook.ok()).toBe(true);
			expect(signupOf('test')).toMatchObject({
				status: 'confirmed',
				transaction_testmode: true,
			});

			// Liv's payment was recorded live.
			const transaction = await request.post(
				'/wp-json/fair-e2e/v1/test-transactions',
				{
					headers: adminHeaders,
					data: {
						event_date_id: event.eventDateId,
						amount: event.price,
						status: 'paid',
						testmode: false,
					},
				}
			);
			expect(transaction.ok()).toBeTruthy();
			await setSignupTransaction(
				'live',
				(await transaction.json()).id,
				'confirmed'
			);

			// Fran's registration is confirmed without any payment, as a free
			// one is.
			await setSignupTransaction('free', 0, 'confirmed');

			for (const status of ['failed', 'expired', 'cancelled']) {
				await setSignupTransaction(
					status,
					signupOf(status).transaction_id || 0,
					status
				);
			}
			expect(signupOf('pending').status).toBe('pending_payment');

			const setMode = async (mode) => {
				const response = await request.post(
					'/wp-json/fair-e2e/v1/payment-mode',
					{ headers: adminHeaders, data: { mode } }
				);
				expect(response.ok()).toBeTruthy();
			};

			await loginAsAdmin(page);
			const listUrl = `/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${event.eventDateId}&tab=list`;
			const list = page.locator('.fair-events-signups');
			const listRows = page.locator('tr.fair-events-signups__ticket');
			const summary = list.getByRole('button', {
				name: 'Summary',
				exact: true,
			});

			const expectedSummary = [
				'Total tickets: 2',
				'',
				'Ticket types:',
				'- General Admission: 2',
				'',
				'Add-ons:',
				'- Yoga: 1',
				'- Tai Chi: 1',
				'',
				'Test payments — excluded from operational totals',
				'',
				'Total tickets: 2',
				'',
				'Ticket types:',
				'- General Admission: 2',
				'',
				'Add-ons:',
				'- Yoga: 2',
				'- Tai Chi: 1',
			].join('\n');

			try {
				for (const mode of ['test', 'live']) {
					await setMode(mode);
					await page.goto(listUrl);

					// The List keeps the test warnings of #1866.
					await expect(listRows).toHaveCount(4);
					await expect(
						listRows.locator('.fair-events-signups__test-payment')
					).toHaveCount(2);
					await expect(
						listRows.filter({ hasText: 'Unsuccessful' })
					).toHaveCount(0);

					await expect(summary).toBeEnabled();
					await summary.click();
					await expect(
						list.getByText('Summary copied to clipboard.')
					).toBeVisible();
					expect(
						await page.evaluate(() =>
							window.navigator.clipboard.readText()
						)
					).toBe(expectedSummary);
				}

				// So does its printout.
				const [popup] = await Promise.all([
					page.waitForEvent('popup'),
					page.getByRole('button', { name: 'Print list' }).click(),
				]);
				await expect(popup.locator('tbody .test-warning')).toHaveText([
					'Test payment',
					'Test payment',
				]);
				await expect(popup.locator('body')).not.toContainText(
					'Unsuccessful'
				);
				await popup.close();
			} finally {
				await setMode('test');
			}
		});
	});
});
