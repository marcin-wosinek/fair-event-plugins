/**
 * Payment Transactions → focused Financial Entry (#1291).
 *
 * An organizer follows a transaction's matched-entry reference to the Fair
 * Finance entries screen, which opens narrowed to that entry — here a split
 * child, normally hidden under its parent — and clears back to the full list.
 * The transaction is seeded by the test-only fair-e2e/v1/transaction-filters
 * routes; the entry, split and match go through the real Finance REST API.
 *
 * Run: `npm run test:e2e:local -- e2e/payment-transaction-entry-link.spec.js`.
 */

import { test, expect, request } from '@playwright/test';
import { ADMIN_USER, ADMIN_PASSWORD, loginAsAdmin } from './support/wp-cli.js';

const TRANSACTIONS_PATH =
	'/wp-admin/admin.php?page=fair-payments-connector-transactions';
const SEED = '/wp-json/fair-e2e/v1/transaction-filters/seed';
const ENTRIES = '/wp-json/fair-finance/v1/financial-entries';
const KEY = `l${Date.now().toString(36)}`;

const adminAuth = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('Transaction entry link', () => {
	let api;
	let parentId;
	let childId;

	test.beforeAll(async ({ baseURL }) => {
		api = await request.newContext({ baseURL });

		const seed = await api.post(SEED, {
			headers: adminAuth,
			data: {
				key: KEY,
				transactions: [
					{
						amount: 25,
						status: 'paid',
						description: `${KEY} workshop ticket`,
						created_at: '2026-06-01 10:00:00',
					},
				],
			},
		});
		expect(seed.ok(), await seed.text()).toBeTruthy();
		const [transactionId] = (await seed.json()).transaction_ids;

		const entry = await api.post(ENTRIES, {
			headers: adminAuth,
			data: {
				amount: 40,
				entry_type: 'income',
				entry_date: '2026-06-01',
				description: `${KEY} bank deposit`,
			},
		});
		expect(entry.ok(), await entry.text()).toBeTruthy();
		parentId = (await entry.json()).id;

		const split = await api.post(`${ENTRIES}/${parentId}/split`, {
			headers: adminAuth,
			data: {
				allocations: [
					{ amount: 25, description: `${KEY} ticket share` },
					{ amount: 15, description: `${KEY} donation share` },
				],
			},
		});
		expect(split.status(), await split.text()).toBe(201);
		childId = (await split.json()).children.find(
			(child) => Number(child.amount) === 25
		).id;

		const match = await api.post(`${ENTRIES}/${childId}/match`, {
			headers: adminAuth,
			data: { transaction_id: transactionId },
		});
		expect(match.ok(), await match.text()).toBeTruthy();
	});

	test.afterAll(async () => {
		if (parentId) {
			await api.delete(`${ENTRIES}/${parentId}`, { headers: adminAuth });
		}
		await api.delete(SEED, { headers: adminAuth, params: { key: KEY } });
		await api.dispose();
	});

	test('a matched split child opens focused and clears to the full list', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(TRANSACTIONS_PATH);

		const form = page.getByRole('form', { name: 'Filter transactions' });
		await form.getByLabel('Search').fill(KEY);
		await form.getByLabel('Search').press('Enter');
		await expect(page.getByText(`${KEY} workshop ticket`)).toBeVisible();

		const link = page.getByRole('link', { name: `#${childId}` });
		await expect(link).toHaveAttribute(
			'href',
			new RegExp(`page=fair-finance-entries&entry_id=${childId}$`)
		);
		await link.click();

		await expect(page).toHaveURL(new RegExp(`entry_id=${childId}$`));
		const notice = page.locator('.components-notice__content', {
			hasText: `Showing entry #${childId}`,
		});
		await expect(notice).toBeVisible();
		await expect(page.getByText(`${KEY} ticket share`)).toBeVisible();
		await expect(page.getByText(`${KEY} donation share`)).toHaveCount(0);
		await expect(page.getByLabel('From Date')).toHaveCount(0);
		// Totals reflect the focused child only.
		await expect(
			page.locator('.fair-finance-entries-summary')
		).toContainText('€25.00');

		await page.getByRole('button', { name: 'Show all entries' }).click();

		await expect(notice).toHaveCount(0);
		await expect(page).not.toHaveURL(/entry_id=/);
		await expect(page.getByLabel('From Date')).toBeVisible();
		// The full list hides split children under their parent again.
		await expect(page.getByText(`${KEY} bank deposit`)).toBeVisible();
		await expect(page.getByText(`${KEY} ticket share`)).toHaveCount(0);
	});
});
