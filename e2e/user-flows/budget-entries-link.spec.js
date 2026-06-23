/**
 * E2E tests for the budget → entries navigation link.
 *
 * Regression test for the fix that changed the "View" button href from
 * `fair-payments-connector-entries` to `fair-finance-entries`.
 *
 * Covers:
 *  1. "View" buttons are visible on the budgets admin page (both a named
 *     budget row and the always-present "Unbudgeted" row).
 *  2. Each button links to the `fair-finance-entries` page (not the old
 *     `fair-payments-connector-entries` page).
 *  3. Following a "View" button lands on the Financial Entries page and
 *     shows the expected heading.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8889';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminAuth = Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
	'base64'
);

test.describe('Budget "View" buttons link to fair-finance-entries', () => {
	let api;
	let budgetId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const res = await api.post('/wp-json/fair-finance/v1/budgets', {
			headers: { Authorization: `Basic ${adminAuth}` },
			data: { name: 'E2E Test Budget', description: 'Created by e2e test' },
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		budgetId = body.id;
		expect(budgetId).toBeTruthy();
	});

	test.afterAll(async () => {
		if (budgetId) {
			await api.delete(`/wp-json/fair-finance/v1/budgets/${budgetId}`, {
				headers: { Authorization: `Basic ${adminAuth}` },
			});
		}
		await api.dispose();
	});

	test.beforeEach(async ({ page }) => {
		await page.goto('/wp-login.php');
		await page.fill('#user_login', ADMIN_USER);
		await page.fill('#user_pass', ADMIN_PASSWORD);
		await page.click('#wp-submit');
		await expect(page).toHaveURL(/\/wp-admin\/?/);
	});

	test('View button for a named budget links to fair-finance-entries', async ({
		page,
	}) => {
		await page.goto('/wp-admin/admin.php?page=fair-finance-budgets');

		// Wait for React app to render the budget table.
		const budgetRow = page.locator('tr', {
			has: page.getByText('E2E Test Budget'),
		});
		await expect(budgetRow).toBeVisible();

		const viewButton = budgetRow.getByRole('link', {
			name: 'View',
			exact: true,
		});
		await expect(viewButton).toBeVisible();

		const href = await viewButton.getAttribute('href');
		expect(href).toContain('page=fair-finance-entries');
		expect(href).not.toContain('fair-payments-connector-entries');
		expect(href).toContain(`budget_id=${budgetId}`);
	});

	test('View button for the Unbudgeted row links to fair-finance-entries', async ({
		page,
	}) => {
		await page.goto('/wp-admin/admin.php?page=fair-finance-budgets');

		// The Unbudgeted row is always rendered at the bottom of the table.
		const unbudgetedRow = page.locator('tr', {
			has: page.getByText('Unbudgeted'),
		});
		await expect(unbudgetedRow).toBeVisible();

		const viewButton = unbudgetedRow.getByRole('link', {
			name: 'View',
			exact: true,
		});
		await expect(viewButton).toBeVisible();

		const href = await viewButton.getAttribute('href');
		expect(href).toContain('page=fair-finance-entries');
		expect(href).not.toContain('fair-payments-connector-entries');
		expect(href).toContain('budget_id=none');
	});

	test('clicking the Unbudgeted View button opens the Financial Entries page', async ({
		page,
	}) => {
		await page.goto('/wp-admin/admin.php?page=fair-finance-budgets');

		const unbudgetedRow = page.locator('tr', {
			has: page.getByText('Unbudgeted'),
		});
		await expect(unbudgetedRow).toBeVisible();

		await unbudgetedRow
			.getByRole('link', { name: 'View', exact: true })
			.click();

		await expect(page).toHaveURL(/page=fair-finance-entries/);

		// The Financial Entries React app should render its heading.
		await expect(
			page.getByRole('heading', { name: 'Financial Entries' })
		).toBeVisible();
	});
});
