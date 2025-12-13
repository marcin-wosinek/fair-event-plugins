/**
 * Basic E2E test for Fair RSVP plugin
 *
 * Validates that the WordPress environment is working and the plugin is active.
 * This is a minimal test to verify the E2E testing infrastructure.
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

test.describe('Fair RSVP Plugin - Basic Checks', () => {
	test.beforeEach(async ({ page }) => {
		// Login to WordPress admin
		await page.goto('/wp-login.php');
		await page.fill('#user_login', WP_ADMIN_USER);
		await page.fill('#user_pass', WP_ADMIN_PASS);
		await page.click('#wp-submit');
		await page.waitForURL('**/wp-admin/**');
	});

	test('should have Fair RSVP plugin active', async ({ page }) => {
		// Navigate to plugins page
		await page.goto('/wp-admin/plugins.php');

		// Check that Fair RSVP plugin row exists and is active
		const pluginRow = page.locator('tr[data-slug="fair-rsvp"]');
		await expect(pluginRow).toBeVisible();

		// Check for active class or deactivate link (indicates plugin is active)
		const isActive = (await pluginRow.locator('.deactivate').count()) > 0;
		expect(isActive).toBe(true);
	});

	test.skip('should have RSVP Button block available in editor', async ({
		page,
	}) => {
		// Create new post
		await page.goto('/wp-admin/post-new.php');

		// Wait for block editor to load
		await page.waitForSelector('.block-editor-page');

		// Click the add block button (the blue "+" button in the toolbar)
		// Find the button by its aria-label or class
		const addBlockButton = page
			.locator(
				'button[aria-label*="Add block"], .edit-post-header-toolbar__inserter-toggle, .block-editor-inserter__toggle'
			)
			.first();
		await addBlockButton.click();

		// Wait for block inserter panel to appear
		await page.waitForSelector('.block-editor-inserter__menu', {
			timeout: 5000,
		});

		// Search for RSVP block
		const searchInput = page
			.locator(
				'.block-editor-inserter__search input, .components-search-control__input'
			)
			.first();
		await searchInput.fill('rsvp');

		// Wait a moment for search results to appear
		await page.waitForTimeout(500);

		// Check that RSVP Button block appears in search results
		const rsvpBlock = page.locator('.block-editor-block-types-list__item', {
			hasText: 'RSVP',
		});

		await expect(rsvpBlock).toBeVisible();
	});
});
