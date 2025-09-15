import { test, expect } from '@playwright/test';

// WordPress admin credentials - update these for your test environment
const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

test.describe('WordPress.org Screenshot for Fair Schedule Blocks', () => {
	test.beforeEach(async ({ page }) => {
		// Login to WordPress admin
		await page.goto('/wp-admin');
		await page.fill('#user_login', WP_ADMIN_USER);
		await page.fill('#user_pass', WP_ADMIN_PASS);
		await page.click('#wp-submit');

		// Wait for dashboard to load
		await page.waitForSelector('#wpadminbar');
	});

	test('Schedule Accordion blocks in Gutenberg editor', async ({ page }) => {
		// Create new post
		await page.goto('/wp-admin/post-new.php');

		// Wait for the block editor iframe to load
		const editorFrame = page.frameLocator('[name="editor-canvas"]');
		await editorFrame.locator('.block-editor-iframe__body').waitFor();

		// Wait a bit for the editor to fully initialize
		await page.waitForTimeout(2000);

		// Add Schedule Accordion block via the main inserter
		await page.getByRole('button', { name: 'Block Inserter' }).click();
		await page.fill(
			'.block-editor-inserter__search input',
			'schedule accordion'
		);
		await page.click(
			'.block-editor-block-types-list__item:has-text("Schedule Accordion")'
		);

		// Wait for schedule accordion container to be inserted in the iframe
		await editorFrame
			.locator('.wp-block-fair-schedule-blocks-schedule-accordion')
			.waitFor();

		// Close the block inserter popup before taking screenshot-1
		const closeInserterButton = page.getByRole('button', {
			name: 'Close Block Inserter',
		});
		if (await closeInserterButton.isVisible()) {
			await closeInserterButton.click();
			await page.waitForTimeout(500);
		}

		// Take screenshot-1 of the editor with schedule accordion blocks (full viewport)
		await page.screenshot({
			path: 'assets/screenshot-1.png',
			fullPage: false,
		});

		// Save/publish the page - use the exact publish button
		const publishButton = page.getByRole('button', {
			name: 'Publish',
			exact: true,
		});
		await publishButton.click();

		// Handle publish panel if it appears
		await page.waitForTimeout(1000);
		const finalPublishButton = page
			.getByLabel('Editor publish')
			.getByRole('button', { name: 'Publish', exact: true });
		if (await finalPublishButton.isVisible()) {
			await finalPublishButton.click();
		}

		// Wait for page to be saved
		await page.waitForTimeout(2000);

		// Get the post URL for viewing
		const viewLink = page
			.getByLabel('Editor publish')
			.getByRole('link', { name: 'View Post' });
		let postUrl = '';
		if (await viewLink.isVisible()) {
			postUrl = await viewLink.getAttribute('href');
		}

		// Log out from admin first
		await page.goto('/wp-admin/');
		const logoutLink = page.locator(
			'a[href*="wp-login.php?action=logout"]'
		);
		if (await logoutLink.isVisible()) {
			await logoutLink.click();
			await page.waitForTimeout(1000);
		} else {
			// Fallback: clear cookies and session
			await page.context().clearCookies();
		}

		// Navigate to frontend view (non-admin)
		if (postUrl) {
			await page.goto(postUrl);
		} else {
			// Fallback: try to navigate to the homepage and find the post
			await page.goto('/');
		}

		// Wait for page to load without admin bar
		await page.waitForTimeout(3000);

		// Wait for frontend to load completely
		await page.waitForFunction(() => {
			return document.readyState === 'complete';
		});

		// Take screenshot-2 of the frontend view (full viewport)
		await page.screenshot({
			path: 'assets/screenshot-2.png',
			fullPage: false,
		});
	});
});
