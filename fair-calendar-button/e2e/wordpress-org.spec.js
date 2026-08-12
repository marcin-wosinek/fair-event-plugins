import { test, expect } from '@playwright/test';

// WordPress admin credentials - update these for your test environment
const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

test.describe('WordPress.org Screenshot for Fair Calendar Button', () => {
	test.beforeEach(async ({ page }) => {
		// Login to WordPress admin
		await page.goto('/wp-admin');
		await page.fill('#user_login', WP_ADMIN_USER);
		await page.fill('#user_pass', WP_ADMIN_PASS);
		await page.click('#wp-submit');

		// Wait for dashboard to load
		await page.waitForSelector('#wpadminbar');
	});

	test('Calendar Button block in Gutenberg editor', async ({ page }) => {
		// Create new post
		await page.goto('/wp-admin/post-new.php');

		// Wait for the block editor iframe to load
		const editorFrame = page.frameLocator('[name="editor-canvas"]');
		await editorFrame.locator('.block-editor-iframe__body').waitFor();

		// Wait a bit for the editor to fully initialize
		await page.waitForTimeout(2000);

		// Add Calendar Button block via the main inserter
		await page.getByRole('button', { name: 'Block Inserter' }).click();
		await page.fill(
			'.block-editor-inserter__search input',
			'calendar button'
		);
		await page.click(
			'.block-editor-block-types-list__item:has-text("Calendar Button")'
		);

		// Wait for block to be inserted in the iframe
		await editorFrame
			.locator('.wp-block-fair-calendar-button-calendar-button')
			.waitFor();

		// Click on the calendar button block container to select it (not the inner button)
		// Try clicking on the breadcrumb to select the parent Calendar Button block
		await page.locator('button:has-text("Calendar Button")').last().click();

		// Wait a moment for the selection to register
		await page.waitForTimeout(1000);

		// Check if settings panel is already open, if not open it
		const settingsPanel = page.locator('.block-editor-block-inspector');
		if (!(await settingsPanel.isVisible())) {
			// Open the settings panel using the specific settings button in the toolbar
			const settingsButton = page
				.locator(
					'button[aria-label="Settings"][aria-controls="edit-post:block"]'
				)
				.first();
			await settingsButton.click();

			// Wait for settings panel to open
			await page.waitForTimeout(500);
		}

		// Expand the Calendar Button Settings panel
		const calendarSettingsButton = page.locator(
			'button:has-text("Calendar Button Settings")'
		);
		if (await calendarSettingsButton.isVisible()) {
			await calendarSettingsButton.click();
			await page.waitForTimeout(500);
		}

		// Get today's date in YYYY-MM-DD format and set time to 16:00
		const today = new Date();
		const todayString =
			today.getFullYear() +
			'-' +
			String(today.getMonth() + 1).padStart(2, '0') +
			'-' +
			String(today.getDate()).padStart(2, '0');
		const startDateTime = todayString + 'T16:00';
		const endDateTime = todayString + 'T17:00';

		// Fill event data in the Calendar Button settings panel
		if ((await settingsPanel.count()) > 0) {
			// Fill start date/time (today at 16:00) - look for the datetime-local input
			const startInput = page
				.locator('input[type="datetime-local"]')
				.first();
			if (await startInput.isVisible()) {
				await startInput.fill(startDateTime);
			}

			// Fill end date/time (today at 17:00) - look for the second datetime-local input
			const endInput = page
				.locator('input[type="datetime-local"]')
				.nth(1);
			if (await endInput.isVisible()) {
				await endInput.fill(endDateTime);
			}

			// Fill description using textarea
			const descriptionInput = page.locator('textarea').first();
			if (await descriptionInput.isVisible()) {
				await descriptionInput.fill(
					'Sample Event - WordPress Plugin Demo'
				);
			}

			// Fill location using text input (try multiple possible selectors)
			const locationInput = page.locator('input[type="text"]').last();
			if (await locationInput.isVisible()) {
				await locationInput.fill('Online Event');
			}
		}

		// Wait for changes to apply
		await page.waitForTimeout(1000);

		// Close the block inserter popup before taking screenshot-1
		const closeInserterButton = page.getByRole('button', {
			name: 'Close Block Inserter',
		});
		if (await closeInserterButton.isVisible()) {
			await closeInserterButton.click();
			await page.waitForTimeout(500);
		}

		// Take screenshot-1 of the editor with settings panel (full viewport)
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

		// Handle publish panel if it appears (use the final publish button in the publish panel)
		await page.waitForTimeout(1000);
		const finalPublishButton = page
			.getByLabel('Editor publish')
			.getByRole('button', { name: 'Publish', exact: true });
		if (await finalPublishButton.isVisible()) {
			await finalPublishButton.click();
		}

		// Wait for page to be saved
		await page.waitForTimeout(2000);

		// Get the post URL for viewing (use the one from the publish panel)
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

		// Wait for page to load without admin bar and for JavaScript to initialize
		await page.waitForTimeout(3000);

		// Wait for frontend JavaScript to load
		await page.waitForFunction(() => {
			return document.readyState === 'complete';
		});

		// Click the "Add to Calendar" button (try both button and link selectors)
		const addToCalendarButton = page.locator(
			'.wp-block-button__link:has-text("Add to Calendar")'
		);
		if (await addToCalendarButton.isVisible()) {
			await addToCalendarButton.click();
			await page.waitForTimeout(2000); // Wait for dropdown to appear
		} else {
			// Fallback: try button selector
			const buttonElement = page.getByRole('button', {
				name: 'Add to Calendar',
			});
			if (await buttonElement.isVisible()) {
				await buttonElement.click();
				await page.waitForTimeout(2000);
			}
		}

		// Take screenshot-2 of the frontend view with dropdown open (full viewport)
		await page.screenshot({
			path: 'assets/screenshot-2.png',
			fullPage: false,
		});
	});
});
