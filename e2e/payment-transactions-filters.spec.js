/**
 * Payment Transactions — search and filters (#1753).
 *
 * An organizer narrows the list with search and an amount range, exports the
 * rows selected in the displayed results, sees the empty state for a query
 * with no matches, and resets to the Paid / Live defaults. Rows are seeded
 * under a per-run key by the test-only fair-e2e/v1/transaction-filters routes.
 *
 * Run: `npm run test:e2e:local -- e2e/payment-transactions-filters.spec.js`.
 */

import { readFile } from 'node:fs/promises';
import { test, expect, request } from '@playwright/test';
import { ADMIN_USER, ADMIN_PASSWORD, loginAsAdmin } from './support/wp-cli.js';

const PAGE_PATH =
	'/wp-admin/admin.php?page=fair-payments-connector-transactions';
const SEED = '/wp-json/fair-e2e/v1/transaction-filters/seed';
const KEY = `e${Date.now().toString(36)}`;

const adminAuth = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('Payment Transactions filters', () => {
	let api;

	test.beforeAll(async ({ baseURL }) => {
		api = await request.newContext({ baseURL });
		const res = await api.post(SEED, {
			headers: adminAuth,
			data: {
				key: KEY,
				participants: [{ name: 'Ines', surname: `Buyer${KEY}` }],
				transactions: [
					{
						amount: 5,
						status: 'paid',
						description: `${KEY} sticker`,
						created_at: '2026-06-01 10:00:00',
					},
					{
						amount: 15,
						status: 'paid',
						description: `${KEY} poster`,
						created_at: '2026-06-02 10:00:00',
						participant: 0,
					},
					{
						amount: 40,
						status: 'paid',
						description: `${KEY} hoodie`,
						created_at: '2026-06-03 10:00:00',
					},
					{
						amount: 40,
						status: 'failed',
						description: `${KEY} failed hoodie`,
						created_at: '2026-06-04 10:00:00',
					},
				],
			},
		});
		expect(res.ok(), await res.text()).toBeTruthy();
	});

	test.afterAll(async () => {
		await api.delete(SEED, { headers: adminAuth, params: { key: KEY } });
		await api.dispose();
	});

	test('an organizer searches, filters, exports and resets', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(PAGE_PATH);

		const form = page.getByRole('form', { name: 'Filter transactions' });
		const search = form.getByLabel('Search');
		const apply = form.getByRole('button', { name: 'Apply filters' });
		const exportButton = page.getByRole('button', {
			name: 'Export Selected',
		});
		const count = page.locator('.fair-admin-list-toolbar__count');
		// Dates and amounts are under More filters.
		const more = form.getByRole('button', { name: /^More filters/ });

		await expect(page.getByText('Status: Paid')).toBeVisible();
		await expect(page.getByText('Mode: Live')).toBeVisible();

		// Typing alone changes nothing; Enter applies the search.
		await search.fill(KEY);
		await expect(
			page.getByText('Filters changed. Select “Apply filters”')
		).toBeVisible();
		await search.press('Enter');
		await expect(count).toHaveText('3 transactions');
		await expect(page.getByText(`Search: ${KEY}`)).toBeVisible();
		await expect(page.getByText(`${KEY} failed hoodie`)).toHaveCount(0);

		// The person shown on a row is searchable.
		await search.fill(`Ines Buyer${KEY}`);
		await apply.click();
		await expect(page.locator('.fair-admin-list-toolbar__count')).toHaveText('1 transaction');
		await expect(page.getByText(`${KEY} poster`)).toBeVisible();

		// A reversed range is explained and cannot be applied.
		await search.fill(KEY);
		await expect(more).toHaveAttribute('aria-expanded', 'false');
		await more.click();
		await form.getByLabel('Minimum amount').fill('50');
		await form.getByLabel('Maximum amount').fill('10');
		await expect(
			page.getByText(
				'The maximum amount must not be less than the minimum amount.'
			)
		).toBeVisible();
		await expect(apply).toHaveAttribute('aria-disabled', 'true');

		await form.getByLabel('Minimum amount').fill('10');
		await form.getByLabel('Maximum amount').fill('');
		await apply.click();
		await expect(count).toHaveText('2 transactions');
		await expect(page.getByText('Amount at least 10')).toBeVisible();

		// Select both displayed rows, then narrow the list: the selection is
		// dropped, so only what is selected afterwards is exported.
		await page.locator('thead input[type="checkbox"]').check();
		await expect(exportButton).toBeVisible();

		await form.getByLabel('Maximum amount').fill('20');
		await apply.click();
		await expect(page.locator('.fair-admin-list-toolbar__count')).toHaveText('1 transaction');
		await expect(exportButton).toHaveCount(0);

		await page.locator('tbody input[type="checkbox"]').check();
		const [download] = await Promise.all([
			page.waitForEvent('download'),
			exportButton.click(),
		]);
		const exported = JSON.parse(
			await readFile(await download.path(), 'utf8')
		);
		expect(exported).toHaveLength(1);
		expect(exported[0]).toMatchObject({
			description: `${KEY} poster`,
			amount: 15,
			mollie_payment_id: `tr_tf${KEY}n1`,
		});

		// A valid query with no matches is an empty state, not an error.
		await search.fill(`${KEY} nothing like this`);
		await apply.click();
		await expect(
			page.getByText('No transactions match these filters.')
		).toBeVisible();
		await expect(count).toHaveCount(0);
		await expect(page.locator('.components-notice.is-error')).toHaveCount(
			0
		);

		await form.getByRole('button', { name: 'Reset filters' }).click();
		await expect(search).toHaveValue('');
		await expect(form.getByLabel('Maximum amount')).toHaveValue('');
		await expect(form.getByLabel('Status')).toHaveValue('paid');
		await expect(form.getByLabel('Mode')).toHaveValue('live');
		await expect(page.getByText(`Search: ${KEY}`)).toHaveCount(0);
		await expect(page.getByText('Status: Paid')).toBeVisible();
		await expect(page.getByText('Mode: Live')).toBeVisible();
	});

	test('rows sort from the keyboard and View details opens the transaction', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(PAGE_PATH);

		const form = page.getByRole('form', { name: 'Filter transactions' });
		await form.getByLabel('Search').fill(KEY);
		await form.getByLabel('Search').press('Enter');
		await expect(
			page.locator('.fair-admin-list-toolbar__count')
		).toHaveText('3 transactions');

		const table = page.getByRole('table', {
			name: 'Payment transactions',
		});
		const amountSort = table.getByRole('button', { name: /^Amount/ });
		const amountHeader = table.locator('th', {
			has: page.getByRole('button', { name: /^Amount/ }),
		});
		const descriptions = table.locator('.fair-admin-table__identity-meta');

		// Enter on the focused header button sorts, and the order is announced.
		await amountSort.focus();
		await page.keyboard.press('Enter');
		await expect(amountHeader).toHaveAttribute('aria-sort', 'descending');
		await expect(descriptions.first()).toHaveText(`${KEY} hoodie`);
		await table.getByRole('button', { name: /^Amount/ }).focus();
		await page.keyboard.press('Space');
		await expect(amountHeader).toHaveAttribute('aria-sort', 'ascending');
		await expect(descriptions.first()).toHaveText(`${KEY} sticker`);

		// Select-all and per-row checkboxes are named.
		await table
			.getByRole('checkbox', {
				name: 'Select all transactions on this page',
			})
			.check();
		await expect(
			table.getByRole('checkbox', { name: /^Select transaction #/ })
		).toHaveCount(3);
		for (const box of await table
			.getByRole('checkbox', { name: /^Select transaction #/ })
			.all()) {
			await expect(box).toBeChecked();
		}
		await expect(
			page.getByRole('button', { name: 'Export Selected' })
		).toBeVisible();

		// View details points at the same transaction as the reference link.
		const row = table.locator('tbody tr', {
			hasText: `${KEY} sticker`,
		});
		const reference = row.locator('.fair-admin-table__identity-name a');
		const href = await reference.getAttribute('href');
		const view = row.getByRole('link', {
			name: /^View details for transaction #\d+$/,
		});
		await expect(view).toHaveAttribute('href', href);
		// A clicked in-page link can stall headless Chromium; follow the href.
		await page.goto(`/wp-admin/${href}`);
		await expect(page).toHaveURL(
			/page=fair-payments-connector-transaction&/
		);
		await expect(page.getByText(`${KEY} sticker`).first()).toBeVisible();
	});

	test('stacked rows keep every value and sort on a phone', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await loginAsAdmin(page);
		await page.goto(PAGE_PATH);

		const form = page.getByRole('form', { name: 'Filter transactions' });
		await form.getByLabel('Search').fill(`Ines Buyer${KEY}`);
		await form.getByLabel('Search').press('Enter');
		await expect(page.locator('.fair-admin-list-toolbar__count')).toHaveText('1 transaction');

		const row = page.locator('.fair-admin-table tbody tr').first();
		for (const text of [
			`${KEY} poster`,
			'15.00',
			'Mollie fee:',
			'Integration fee:',
			'Paid',
			'Live mode',
			`Ines Buyer${KEY}`,
			'View details',
		]) {
			await expect(row.getByText(text).first(), text).toBeVisible();
		}
		await expect(row.getByRole('checkbox')).toBeVisible();

		// No horizontal page scroll.
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);

		// Headers are hidden, so a labeled control sorts instead.
		const sortBy = page.getByLabel('Sort by');
		await expect(sortBy).toBeVisible();
		await sortBy.selectOption('amount:asc');
		await expect(page.locator('.fair-admin-list-toolbar__count')).toHaveText('1 transaction');
		await expect(
			page.getByRole('checkbox', {
				name: 'Select all transactions on this page',
			})
		).toBeVisible();
	});

	for (const [name, viewport] of [
		['tablet', { width: 768, height: 1024 }],
		['mobile', { width: 375, height: 812 }],
	]) {
		test(`the filter controls fit a ${name} screen`, async ({ page }) => {
			await page.setViewportSize(viewport);
			await loginAsAdmin(page);
			await page.goto(PAGE_PATH);

			const form = page.getByRole('form', {
				name: 'Filter transactions',
			});
			await expect(
				form.getByRole('button', { name: 'Apply filters' })
			).toBeVisible();

			await form.getByRole('button', { name: /^More filters/ }).click();
			const formBox = await form.boundingBox();
			expect(formBox.x).toBeGreaterThanOrEqual(0);
			expect(formBox.x + formBox.width).toBeLessThanOrEqual(
				viewport.width
			);
			for (const label of [
				'Search',
				'Status',
				'Mode',
				'From date',
				'To date',
				'Minimum amount',
				'Maximum amount',
			]) {
				const box = await form.getByLabel(label).boundingBox();
				expect(box.x, label).toBeGreaterThanOrEqual(formBox.x);
				expect(box.x + box.width, label).toBeLessThanOrEqual(
					formBox.x + formBox.width + 1
				);
			}
		});
	}
});
