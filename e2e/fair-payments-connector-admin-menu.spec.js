/**
 * Fair Payments Connector admin pages — mount smoke.
 *
 * Mirrors fair-events-admin-menu.spec.js for the connector: every admin page
 * must render its React root AND mount something into it. An empty root with
 * no children is the exact failure mode of a broken asset enqueue (the page
 * renders `<div id="…-root">` but no JS loads) — which a PHP-only check would
 * miss.
 *
 * Run: `npm run test:e2e -- fair-payments-connector-admin-menu`.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

/** Every Fair Payments Connector admin page and its React root element id. */
const PAGES = [
	{
		slug: 'fair-payments-connector-transactions',
		root: 'fair-payments-connector-transactions-root',
	},
	{
		slug: 'fair-payments-connector-fee-dashboard',
		root: 'fair-payments-connector-fee-dashboard-root',
	},
	{
		slug: 'fair-payments-connector-settings',
		root: 'fair-payments-connector-settings-root',
	},
];

test.describe('Fair Payments Connector admin menu', () => {
	test('top-level menu is present with Transactions, Fee Dashboard and Settings', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/');

		const menu = page.locator(
			'#toplevel_page_fair-payments-connector-transactions'
		);
		await expect(menu).toBeVisible();

		for (const { slug } of PAGES) {
			await expect(
				menu.locator(`a[href*="page=${slug}"]`).first(),
				`menu link for ${slug} missing`
			).toBeAttached();
		}
	});

	test('every page mounts its React root', async ({ page }) => {
		await loginAsAdmin(page);

		for (const { slug, root } of PAGES) {
			await page.goto(`/wp-admin/admin.php?page=${slug}`);
			await expect(
				page.locator(`#${root}`),
				`${slug}: React root element missing`
			).toBeAttached();
			await expect(
				page.locator(`#${root} > *`).first(),
				`${slug}: root is empty — admin bundle did not load`
			).toBeAttached({ timeout: 15000 });
		}
	});
});
