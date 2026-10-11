/**
 * Saved Mollie settlements (#1694): an administrator imports a settlement
 * from a CSV export and from Mollie, sees both converge on one record,
 * recovers an interrupted import, and reopens saved settlements while Mollie
 * is disconnected. Existing reconciliation stays usable.
 *
 * Mollie is served by lib/mollie-http-double.php and steered through the
 * helper routes in fair-e2e-settlements.php, so no request leaves the host.
 */
import { test, expect, request } from '@playwright/test';
import { loginAsAdmin, ADMIN_USER, ADMIN_PASSWORD } from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const PAGE = '/wp-admin/admin.php?page=fair-finance-settlements';
const HELPERS = '/wp-json/fair-e2e/v1/settlements';

// The same payout the double reports as stl_e2e0001.
const CSV = [
	'Date,Payment method,Currency,Amount,Status,ID,Description,Consumer name,Consumer bank account,Consumer BIC,Settlement currency,Settlement amount,Settlement reference,Amount refunded',
	'2026-05-01 10:00:00,ideal,EUR,25.00,paid,tr_e2estl01a,Ticket A,Jane Example,NL00BANK0123456789,,EUR,25.00,E2E.2605.01,',
	'2026-05-01 10:00:00,ideal,EUR,15.00,paid,tr_e2estl01b,Ticket B,,,,EUR,15.00,E2E.2605.01,',
	',,EUR,-1.45,,,Transaction fees ideal,,,,EUR,-1.45,E2E.2605.01,',
	'',
].join('\n');

test.describe('Fair Finance settlements', () => {
	let api;

	const setState = async (data) => {
		const res = await api.post(`${HELPERS}/state`, {
			headers: adminHeaders,
			data,
		});
		expect(res.ok(), await res.text()).toBeTruthy();
	};

	const mollieRequests = async () => {
		const res = await api.get(`${HELPERS}/state`, {
			headers: adminHeaders,
		});
		return (await res.json()).requests;
	};

	const setConnected = async (connected) => {
		const res = await api.post('/wp-json/fair-e2e/v1/mollie-connection', {
			headers: adminHeaders,
			data: { connected },
		});
		expect(res.ok(), await res.text()).toBeTruthy();
	};

	// Notices are also announced in a live region outside the app, so text
	// is looked up inside the app itself.
	const inApp = (page) => page.locator('#fair-finance-settlements-root');

	// Following a link by clicking stalls rendering of the next page in
	// headless Chromium on this WordPress build, so the link's address is
	// checked and opened directly.
	const follow = async (page, link) => {
		const href = await link.getAttribute('href');
		expect(href).toMatch(/^admin\.php\?page=fair-finance-/);
		await page.goto(`/wp-admin/${href}`);
	};

	const rowFor = (page, name) =>
		page.locator('.fair-finance-settlements-table tbody tr', {
			has: page.getByRole('link', { name, exact: true }),
		});

	test.beforeAll(async ({ baseURL }) => {
		api = await request.newContext({ baseURL });
	});

	test.beforeEach(async () => {
		const res = await api.post(`${HELPERS}/reset`, {
			headers: adminHeaders,
		});
		expect(res.ok(), await res.text()).toBeTruthy();
	});

	test.afterAll(async () => {
		await api.post(`${HELPERS}/reset`, {
			headers: adminHeaders,
			data: { restore: true },
		});
		await api.dispose();
	});

	test('saves a settlement from a CSV and from Mollie, converges them, and reopens it while disconnected', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(PAGE);
		// Clicking an admin menu link stalls rendering in headless Chromium,
		// so the menu entry is checked and pages are opened directly.
		await expect(
			page
				.locator('#adminmenu')
				.getByRole('link', { name: 'Settlements' })
		).toHaveAttribute('href', /page=fair-finance-settlements/);
		await expect(
			page.getByRole('heading', { name: 'Settlements', level: 1 })
		).toBeVisible();
		await expect(
			inApp(page).getByText('No settlements are saved yet.')
		).toBeVisible();

		// 1. CSV import, with nothing saved from Mollie yet.
		await page
			.getByRole('button', { name: 'Import settlement CSV' })
			.click();
		const dialog = page.getByRole('dialog', {
			name: 'Import settlement CSV',
		});
		await expect(dialog.getByText('Choose a file first.')).toBeVisible();
		await dialog.getByLabel('Settlement file').setInputFiles({
			name: 'settlement.csv',
			mimeType: 'text/csv',
			buffer: Buffer.from(CSV, 'utf8'),
		});
		await expect(
			dialog.getByText(
				'The file is valid. A new settlement will be saved.'
			)
		).toBeVisible();
		await expect(dialog.getByText('E2E.2605.01')).toBeVisible();
		await expect(dialog.getByText('Name the account first.')).toBeVisible();
		await dialog.getByLabel('Account name').fill('Old exports');
		await dialog.getByRole('button', { name: 'Import settlement' }).click();
		await expect(
			dialog.getByText('The settlement was saved.')
		).toBeVisible();
		await follow(
			page,
			dialog.getByRole('link', { name: 'Open settlement' })
		);

		// The saved file: what it does not state stays unknown.
		await expect(page).toHaveURL(/settlement=\d+/);
		const fileUrl = page.url();
		await expect(
			page.getByRole('heading', { name: /Settlement E2E\.2605\.01/ })
		).toBeVisible();
		await expect(
			inApp(page).getByText(
				'This settlement comes from an uploaded file.',
				{
					exact: false,
				}
			)
		).toBeVisible();
		await expect(
			page.locator('.fair-finance-settlements-facts div', {
				hasText: 'Payout amount',
			})
		).toContainText('Unknown');
		await expect(inApp(page).getByText('tr_e2estl01a')).toBeVisible();
		await expect(
			inApp(page).getByText('Transaction fees ideal')
		).toBeVisible();
		await expect(inApp(page).getByText('Jane Example')).toHaveCount(0);
		expect(await mollieRequests()).toBe(0);

		// 2. Load from Mollie: every page, in steps, with progress.
		await page.goto(PAGE);
		await page
			.getByRole('button', { name: 'Load settlements from Mollie' })
			.click();
		await expect(
			inApp(page).getByText('Loaded 3 settlements from Mollie.')
		).toBeVisible({ timeout: 30000 });

		// The file's account is not confirmed, so its settlement stays apart.
		await expect(
			page.locator('.fair-finance-settlements-table tbody tr')
		).toHaveCount(4);
		await expect(
			page.getByRole('link', { name: 'E2E.2605.01', exact: true })
		).toHaveCount(2);
		await expect(rowFor(page, 'E2E.2605.02')).toContainText('50.00 EUR');
		await expect(rowFor(page, 'stl_e2e0003')).toContainText('open');

		// 3. Confirm the account: both sources become one record.
		await page
			.getByRole('button', { name: 'Confirm it is org_e2e0001' })
			.click();
		await page.getByRole('button', { name: 'Confirm account' }).click();
		await expect(
			inApp(page).getByText('Old exports is now confirmed.', {
				exact: false,
			})
		).toBeVisible();
		await expect(
			page.locator('.fair-finance-settlements-table tbody tr')
		).toHaveCount(3);
		const merged = rowFor(page, 'E2E.2605.01');
		await expect(merged).toContainText('Mollie and file');
		await expect(merged).toContainText('38.55 EUR');
		await expect(merged).toContainText('Adds up to payout');

		// 4. Disconnect Mollie: saved settlements still open, without a request.
		const requests = await mollieRequests();
		await setConnected(false);
		await page.reload();
		await expect(
			inApp(page).getByText(
				'Saved settlements and CSV import keep working.',
				{
					exact: false,
				}
			)
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Load settlements from Mollie' })
		).toBeDisabled();

		await follow(
			page,
			rowFor(page, 'E2E.2605.01').getByRole('link', {
				name: 'E2E.2605.01',
			})
		);
		await expect(
			page.getByRole('heading', { name: /Settlement E2E\.2605\.01/ })
		).toBeVisible();
		await expect(
			page.locator('.fair-finance-settlements-facts div', {
				hasText: 'Payout amount',
			})
		).toContainText('38.55 EUR');
		await expect(inApp(page).getByText('stl_e2e0001')).toBeVisible();
		const payment = page.locator('tr', { hasText: 'tr_e2estl01b' });
		await expect(payment).toContainText('15.00 EUR');
		await expect(payment).toContainText('Mollie and file');
		await expect(payment).toContainText('Not imported yet');
		await expect(
			page.getByRole('button', { name: 'Refresh from Mollie' })
		).toBeDisabled();
		expect(await mollieRequests()).toBe(requests);

		// The file-only record was folded into Mollie's; its own address
		// says so instead of showing stale data.
		await page.goto(fileUrl);
		await expect(
			inApp(page).getByText('This settlement is not saved on this site.')
		).toBeVisible();
	});

	test('continues an interrupted import after the page is reopened', async ({
		page,
	}) => {
		await setState({
			fail_match: 'stl_e2e0001/payments?from=tr_e2estl01b',
		});

		await loginAsAdmin(page);
		await page.goto(PAGE);
		await page
			.getByRole('button', { name: 'Load settlements from Mollie' })
			.click();
		await expect(
			inApp(page).getByText('An import from Mollie did not finish.')
		).toBeVisible({ timeout: 30000 });

		// The half-loaded settlement is marked, not presented as complete.
		const partial = rowFor(page, 'E2E.2605.01');
		await expect(partial).toContainText('Incomplete');
		await expect(partial).toContainText('Last load failed');

		await setState({ fail_match: '' });
		await page.reload();
		await expect(
			inApp(page).getByText('An import from Mollie did not finish.')
		).toBeVisible();
		await page.getByRole('button', { name: 'Continue import' }).click();
		await expect(
			inApp(page).getByText('Loaded 3 settlements from Mollie.')
		).toBeVisible({ timeout: 30000 });

		const complete = rowFor(page, 'E2E.2605.01');
		await expect(complete).toContainText('Adds up to payout');
		await expect(complete).not.toContainText('Last load failed');
		await expect(
			page.locator('.fair-finance-settlements-table tbody tr')
		).toHaveCount(3);
	});

	test('shows what a refresh changed and keeps the earlier data on failure', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(PAGE);
		await page
			.getByRole('button', { name: 'Load settlements from Mollie' })
			.click();
		await expect(
			inApp(page).getByText('Loaded 3 settlements from Mollie.')
		).toBeVisible({ timeout: 30000 });

		await follow(
			page,
			rowFor(page, 'E2E.2605.01').getByRole('link', {
				name: 'E2E.2605.01',
			})
		);
		const payout = page.locator('.fair-finance-settlements-facts div', {
			hasText: 'Payout amount',
		});
		await expect(payout).toContainText('38.55 EUR');

		// Mollie reports new amounts, but the refresh fails half-way.
		await setState({
			variant: 'changed',
			fail_match: 'stl_e2e0001/payments?from=tr_e2estl01b',
		});
		await page.getByRole('button', { name: 'Refresh from Mollie' }).click();
		await expect(
			page.getByRole('button', { name: 'Try again' })
		).toBeVisible({ timeout: 30000 });
		await expect(payout).toContainText('38.55 EUR');

		await setState({ fail_match: '' });
		await page.getByRole('button', { name: 'Try again' }).click();
		await expect(
			inApp(page).getByText('Refreshed from Mollie.')
		).toBeVisible({
			timeout: 30000,
		});
		await expect(payout).toContainText('37.55 EUR');
		await expect(
			inApp(page).getByText(
				'Mollie reported different data for this settlement on a later refresh.',
				{ exact: false }
			)
		).toBeVisible();
	});

	test('keeps reconciliation usable and links it to saved settlements', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-finance-reconciliation');
		await expect(
			page.getByRole('heading', { name: 'Reconciliation', level: 1 })
		).toBeVisible();

		// The existing settlement-matching import is still there.
		await page
			.getByRole('button', { name: 'Import settlement CSV' })
			.click();
		const legacy = page.getByRole('dialog');
		await expect(legacy).toBeVisible();
		await legacy
			.getByRole('button', { name: /Cancel|Close/ })
			.first()
			.click();

		await follow(
			page,
			page.getByRole('link', { name: 'Saved settlements' })
		);
		await expect(page).toHaveURL(/page=fair-finance-settlements/);
		await expect(
			page.getByRole('heading', { name: 'Settlements', level: 1 })
		).toBeVisible();
	});
});
