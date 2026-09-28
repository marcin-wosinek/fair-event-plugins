/**
 * Fair Payments Connector Fee Dashboard — monthly statistics (#1685).
 *
 * Seeds paid transactions in the previous month under a currency no other
 * spec uses (CHF), then navigates there and back in the real admin page,
 * and checks the page stays within the viewport on a phone-sized screen.
 *
 * Run: `npm run test:e2e:local -- e2e/fair-payments-connector-fee-dashboard.spec.js`.
 */

import { test, expect, request } from '@playwright/test';
import { ADMIN_USER, ADMIN_PASSWORD, loginAsAdmin } from './support/wp-cli.js';

const PAGE_PATH =
	'/wp-admin/admin.php?page=fair-payments-connector-fee-dashboard';
const API = '/wp-json/fair-payments-connector/v1';
const PREFIX = 'tr_e2e1685_';

const adminAuth = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const monthKey = (date) => date.toISOString().slice(0, 7);

const monthLabel = (key) => {
	const [year, month] = key.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, 1)).toLocaleString('en-US', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	});
};

const now = new Date();
const currentMonth = monthKey(now);
const previousMonth = monthKey(
	new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
);

async function deleteSeeded(api) {
	for (const mode of ['test', 'live']) {
		const res = await api.get(`${API}/transactions`, {
			headers: adminAuth,
			params: { per_page: 100, mode },
		});
		const { transactions = [] } = await res.json();
		for (const txn of transactions) {
			if (txn.mollie_payment_id?.startsWith(PREFIX)) {
				await api.delete(`${API}/transactions/${txn.id}`, {
					headers: adminAuth,
				});
			}
		}
	}
}

test.describe('Fair Payments Connector Fee Dashboard', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext();
		const summary = await (
			await api.get(`${API}/dashboard/monthly-summary`, {
				headers: adminAuth,
			})
		).json();
		await deleteSeeded(api);

		const seed = (key, overrides) => ({
			mollie_payment_id: PREFIX + key,
			currency: 'CHF',
			status: 'paid',
			testmode: summary.testmode,
			created_at: `${previousMonth}-10 12:00:00`,
			...overrides,
		});
		const res = await api.post(`${API}/transactions/import`, {
			headers: adminAuth,
			data: {
				transactions: [
					seed('complete', {
						amount: 100,
						application_fee: 2,
						mollie_fee: 1,
					}),
					seed('awaiting', { amount: 50, application_fee: 1 }),
				],
			},
		});
		expect(res.ok()).toBeTruthy();
	});

	test.afterAll(async () => {
		await deleteSeeded(api);
		await api.dispose();
	});

	test('navigates between months and shows the monthly figures', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(PAGE_PATH);

		const heading = page.getByTestId('fee-dashboard-month');
		await expect(heading).toHaveText(monthLabel(currentMonth));
		await expect(page.getByText('Paid transactions').first()).toBeVisible({
			timeout: 15000,
		});
		await expect(page.locator('[data-currency="CHF"]')).toHaveCount(0);

		await page.getByRole('button', { name: 'Previous month' }).click();
		await expect(heading).toHaveText(monthLabel(previousMonth));

		const chf = page.locator('[data-currency="CHF"]');
		await expect(chf).toBeVisible({ timeout: 15000 });
		await expect(
			chf.getByText(
				'1 paid transaction is still awaiting Mollie fee data. The Mollie commission and the amount after fees are incomplete until it arrives.'
			)
		).toBeVisible();
		await expect(chf.getByText('150,00')).toBeVisible();
		// 150 − 3 Fair Event − 1 Mollie (known so far).
		await expect(chf.getByText('146,00')).toBeVisible();
		await expect(chf.getByText('Incomplete', { exact: true })).toHaveCount(
			2
		);

		await page.getByRole('button', { name: 'Current month' }).click();
		await expect(heading).toHaveText(monthLabel(currentMonth));
		await expect(page.locator('[data-currency="CHF"]')).toHaveCount(0);
	});

	test('fits a phone-sized viewport without horizontal scrolling', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await loginAsAdmin(page);
		await page.goto(PAGE_PATH);
		await page.getByRole('button', { name: 'Previous month' }).click();
		await expect(page.locator('[data-currency="CHF"]')).toBeVisible({
			timeout: 15000,
		});

		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});
});
