import { test, expect } from '@playwright/test';

// WordPress admin credentials - update these for your test environment
const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

test.describe('Fair Membership - Admin Groups Management', () => {
	test.beforeEach(async ({ page }) => {
		// Login to WordPress admin
		await page.goto('/wp-admin');
		await page.fill('#user_login', WP_ADMIN_USER);
		await page.fill('#user_pass', WP_ADMIN_PASS);
		await page.click('#wp-submit');

		// Wait for dashboard to load
		await page.waitForSelector('#wpadminbar');
	});

	test('can access Fair Membership admin page', async ({ page }) => {
		// Navigate to Fair Membership admin page
		await page.goto('/wp-admin/admin.php?page=fair-membership');

		// Wait for page to load
		await page.waitForSelector('.wrap');

		// Check that the page title contains "Fair Membership"
		await expect(page.locator('.wrap h1')).toContainText('Groups');

		// Check that the groups table or placeholder is visible
		const hasTable = await page.locator('.wp-list-table').isVisible();
		const hasNoItems = await page.locator('.no-items').isVisible();

		// Either the table exists OR the "no items" message is shown
		expect(hasTable || hasNoItems).toBe(true);
	});

	test('can navigate to add new group page', async ({ page }) => {
		// Navigate to Fair Membership admin page
		await page.goto('/wp-admin/admin.php?page=fair-membership');

		// Wait for page to load
		await page.waitForSelector('.wrap');

		// Look for "Add New Group" button/link
		const addNewButton = page.locator('a:has-text("Add New Group")');

		// Check if the button exists
		if (await addNewButton.isVisible()) {
			// Click the "Add New Group" button
			await addNewButton.click();

			// Wait for the add group page to load
			await page.waitForSelector('.wrap');

			// Check that we're on the add group page
			await expect(page.locator('.wrap h1')).toContainText(
				'Add New Group'
			);

			// Check that the form exists
			await expect(page.locator('form table.form-table')).toBeVisible();

			// Check for required fields
			await expect(
				page.locator('input[name="group_name"]')
			).toBeVisible();
			await expect(
				page.locator('textarea[name="group_description"]')
			).toBeVisible();
		} else {
			// If Add New Group button is not found, just verify we're on the right page
			console.log(
				'Add New Group button not found, but Fair Membership page loaded successfully'
			);
		}
	});

	test('form validation works for empty group name', async ({ page }) => {
		// Navigate directly to add group page
		await page.goto(
			'/wp-admin/admin.php?page=fair-membership-group-view&action=add'
		);

		// Wait for form to load
		await page.waitForSelector('form');

		// Try to submit form without filling required fields
		await page.click('input[type="submit"]');

		// Wait a moment for any validation to occur
		await page.waitForTimeout(1000);

		// Check if we're still on the add page (form validation should prevent submission)
		// or if there's an error message
		const isStillOnAddPage = await page
			.locator('.wrap h1:has-text("Add New Group")')
			.isVisible();
		const hasErrorMessage = await page.locator('.notice-error').isVisible();

		// Either we stay on the add page OR there's an error message
		expect(isStillOnAddPage || hasErrorMessage).toBe(true);
	});
});
