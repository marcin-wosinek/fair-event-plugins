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

import { test, expect } from '@playwright/test';
import { runScript, loginAsAdmin } from '../support/wp-cli.js';

test.describe('Budget "View" buttons link to fair-finance-entries', () => {
	let budgetId;

	test.beforeAll(() => {
		const seed = runScript('seed-budget.php', 'E2E_BUDGET_SEED');
		budgetId = seed.budgetId;
	});

	test.afterAll(() => {
		if (budgetId) {
			runScript(
				'cleanup-budget.php',
				'E2E_BUDGET_CLEANUP',
				`${budgetId}`
			);
		}
	});

	test.beforeEach(async ({ page }) => {
		await loginAsAdmin(page);
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
