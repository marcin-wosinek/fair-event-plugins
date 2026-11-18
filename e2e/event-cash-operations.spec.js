/**
 * Event cash income and personally paid expenses (#2272): from an event's
 * Finance tab an organizer records €115 cash income, a €20 event-cash
 * expense and a €30 personal expense, corrects and deletes operations, and
 * finds them in Fair Finance accounting — with the payments connector
 * inactive.
 */
import { test, expect, request } from '@playwright/test';
import {
	loginAsAdmin,
	wpCli,
	ADMIN_USER,
	ADMIN_PASSWORD,
} from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const ENTRIES_API = '/wp-json/fair-finance/v1/financial-entries';
const STAMP = Date.now().toString(36);
const EVENT_TITLE = `E2E cash event ${STAMP}`;
const PAYER = `Anna ${STAMP}`;
const EVENT_DAY = '2032-03-12';

test.describe('Event Finance income and expenses', () => {
	let api;
	let postId;
	let eventDateId;
	let connectorWasActive = false;

	test.beforeAll(async ({ baseURL }) => {
		api = await request.newContext({ baseURL });

		const post = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: EVENT_TITLE, status: 'publish' },
		});
		expect(post.ok(), await post.text()).toBeTruthy();
		postId = (await post.json()).id;

		const ensure = await api.post(
			'/wp-json/fair-events/v1/event-dates/ensure-for-post',
			{ headers: adminHeaders, data: { post_id: postId } }
		);
		expect(ensure.ok(), await ensure.text()).toBeTruthy();
		eventDateId = (await ensure.json()).id;

		const dated = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
			{
				headers: adminHeaders,
				data: {
					start_date: EVENT_DAY,
					end_date: EVENT_DAY,
					all_day: true,
				},
			}
		);
		expect(dated.ok(), await dated.text()).toBeTruthy();

		connectorWasActive =
			'active' ===
			wpCli('plugin get fair-payments-connector --field=status', {
				allowFailure: true,
			}).trim();
	});

	test.afterAll(async () => {
		if (connectorWasActive) {
			wpCli('plugin activate fair-payments-connector', {
				allowFailure: true,
			});
		}
		if (eventDateId) {
			const list = await api.get(
				`${ENTRIES_API}?event_date_id=${eventDateId}&per_page=100`,
				{ headers: adminHeaders }
			);
			for (const entry of (await list.json()).entries || []) {
				await api.delete(`${ENTRIES_API}/${entry.id}`, {
					headers: adminHeaders,
				});
			}
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{
					headers: adminHeaders,
				}
			);
		}
		if (postId) {
			await api.delete(`/wp-json/wp/v2/fair_event/${postId}?force=true`, {
				headers: adminHeaders,
			});
		}
		await api.dispose();
	});

	// An amount in the event result's costs breakdown.
	const costRow = (page, label) =>
		page
			.getByRole('list', { name: 'Costs breakdown' })
			.getByText(label, { exact: true })
			.locator('xpath=following-sibling::span[1]');

	const cashMovement = (page) => page.getByTestId('event-cash-movement');

	// Open a collapsed list once; later calls leave it open.
	const openList = async (page, name) => {
		const toggle = page.getByRole('button', { name });
		if ((await toggle.getAttribute('aria-expanded')) !== 'true') {
			await toggle.click();
		}
	};

	const addOperation = async (
		page,
		button,
		{ amount, note, personal = false, payer = '' }
	) => {
		await page.getByRole('button', { name: button }).click();
		const dialog = page.getByRole('dialog', { name: button });
		await dialog.getByLabel('Amount (EUR)').fill(amount);
		if (personal) {
			await dialog.getByLabel('Personal funds').check();
			await dialog.getByLabel('Paid by').fill(payer);
		}
		await dialog.getByLabel(/^Note/).fill(note);
		await dialog.getByRole('button', { name: /^Save / }).click();
		await expect(dialog).toBeHidden();
	};

	test('records, corrects and deletes operations without the connector', async ({
		page,
	}) => {
		wpCli('plugin deactivate fair-payments-connector', {
			allowFailure: true,
		});

		await loginAsAdmin(page);
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${eventDateId}&tab=finance`
		);
		await expect(
			page.getByRole('heading', { name: 'Expenses and cash sales' })
		).toBeVisible();

		// The operation date defaults to the event's date.
		await page.getByRole('button', { name: 'Add income' }).click();
		const incomeDialog = page.getByRole('dialog', { name: 'Add income' });
		await expect(incomeDialog.getByLabel('Date')).toHaveValue(EVENT_DAY);
		// A missing amount keeps the save button disabled with its reason.
		await expect(
			incomeDialog.getByRole('button', { name: 'Save income' })
		).toHaveAttribute('aria-disabled', 'true');
		await expect(incomeDialog.getByText('Enter an amount.')).toBeVisible();
		await incomeDialog.getByRole('button', { name: 'Cancel' }).click();

		await addOperation(page, 'Add income', {
			amount: '115',
			note: `Gate sales ${STAMP}`,
		});
		await expect(page.getByText('Income added.').first()).toBeVisible();
		await addOperation(page, 'Add expense', {
			amount: '20',
			note: `Ice ${STAMP}`,
		});
		await addOperation(page, 'Add expense', {
			amount: '30',
			note: `Decorations ${STAMP}`,
			personal: true,
			payer: PAYER,
		});

		await expect(cashMovement(page)).toContainText(
			'€115.00 received, €20.00 paid out, €95.00 net cash movement'
		);
		await expect(costRow(page, 'Recorded expenses')).toHaveText('€50.00');
		await expect(costRow(page, 'Paid personally')).toHaveText('€30.00');
		await expect(costRow(page, 'Paid from event cash')).toHaveText(
			'€20.00'
		);
		await expect(
			page.getByRole('list', { name: 'Personally paid by payer' })
		).toContainText(PAYER);

		// The lists are collapsed on arrival.
		await openList(page, /^Cash sales/);
		const sales = page.getByRole('table', { name: 'Cash sales' });

		// Correct the income: €120.
		await sales
			.getByRole('row')
			.filter({ hasText: `Gate sales ${STAMP}` })
			.getByRole('button', { name: 'Edit' })
			.click();
		const editDialog = page.getByRole('dialog', { name: 'Edit income' });
		await editDialog.getByLabel('Amount (EUR)').fill('120');
		await editDialog.getByRole('button', { name: 'Save income' }).click();
		await expect(editDialog).toBeHidden();
		await expect(cashMovement(page)).toContainText(
			'€100.00 net cash movement'
		);

		// Delete the event-cash expense.
		await openList(page, /^Expenses/);
		const expenses = page.getByRole('table', { name: 'Expenses' });
		await expenses
			.getByRole('row')
			.filter({ hasText: `Ice ${STAMP}` })
			.getByRole('button', { name: /^More actions for/ })
			.click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		const confirm = page.getByRole('dialog', { name: 'Delete expense' });
		await confirm.getByRole('button', { name: 'Delete expense' }).click();
		await expect(confirm).toBeHidden();
		await expect(cashMovement(page)).toContainText(
			'€120.00 net cash movement'
		);
		await expect(costRow(page, 'Recorded expenses')).toHaveText('€30.00');
		await expect(expenses.getByText(`Ice ${STAMP}`)).toHaveCount(0);

		// The operations are ordinary Fair Finance accounting entries.
		await page.goto(
			`/wp-admin/admin.php?page=fair-finance-entries&event_date_id=${eventDateId}`
		);
		const personalRow = page
			.getByRole('row')
			.filter({ hasText: `Decorations ${STAMP}` });
		await expect(personalRow).toContainText(
			`Personal funds, paid by ${PAYER}`
		);
		await expect(
			page.getByRole('row').filter({ hasText: `Gate sales ${STAMP}` })
		).toContainText('Event cash');
	});
});
