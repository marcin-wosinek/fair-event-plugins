import { test, expect } from '@playwright/test';

// WordPress admin credentials
const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

test.describe('Timetable Length E2E Tests', () => {
	test.beforeEach(async ({ page }) => {
		// Login to WordPress admin
		await page.goto('/wp-admin');
		await page.fill('#user_login', WP_ADMIN_USER);
		await page.fill('#user_pass', WP_ADMIN_PASS);
		await page.click('#wp-submit');

		// Wait for dashboard to load
		await page.waitForSelector('#wpadminbar');
	});

	test('should change column height when timetable length is changed', async ({
		page,
	}) => {
		// Create new post
		await page.goto('/wp-admin/post-new.php');

		// Wait for the block editor iframe to load
		const editorFrame = page.frameLocator('[name="editor-canvas"]');
		await editorFrame.locator('.block-editor-iframe__body').waitFor();

		// Wait for editor to fully initialize
		await page.waitForTimeout(2000);

		// Add Timetable Container block via the main inserter
		await page.getByRole('button', { name: 'Block Inserter' }).click();
		await page.fill('.block-editor-inserter__search input', 'timetable');
		await page.click(
			'.block-editor-block-types-list__item:has-text("Timetable")'
		);

		// Wait for timetable container to be inserted in the iframe
		await editorFrame
			.locator('.wp-block-fair-timetable-timetable')
			.waitFor();

		// Close the block inserter popup
		const closeInserterButton = page.getByRole('button', {
			name: 'Close Block Inserter',
		});
		if (await closeInserterButton.isVisible()) {
			await closeInserterButton.click();
			await page.waitForTimeout(500);
		}

		// Get initial column height
		const timeColumnBody = editorFrame
			.locator('.time-column-body-container')
			.first();
		await timeColumnBody.waitFor();

		const initialHeight = await timeColumnBody.evaluate((el) => {
			return window.getComputedStyle(el).height;
		});

		// Find and change the length select control
		const lengthSelect = page
			.locator('select')
			.filter({ hasText: /hours/ })
			.first();
		await lengthSelect.waitFor();

		// Get current length value
		const currentLength = await lengthSelect.inputValue();

		// Change to a different length (if current is 8, change to 12, otherwise change to 8)
		const newLength = currentLength === '8' ? '12' : '8';
		await lengthSelect.selectOption(newLength);

		// Wait for changes to apply
		await page.waitForTimeout(1000);

		// Get new column height
		const newHeight = await timeColumnBody.evaluate((el) => {
			return window.getComputedStyle(el).height;
		});

		// Parse heights to numbers for comparison
		const initialHeightNum = parseFloat(initialHeight);
		const newHeightNum = parseFloat(newHeight);

		// Debug: log the height values to understand what's happening
		console.log(
			'Initial height:',
			initialHeight,
			'Parsed:',
			initialHeightNum
		);
		console.log('New height:', newHeight, 'Parsed:', newHeightNum);

		// Verify heights are valid numbers
		expect(initialHeightNum).not.toBeNaN();
		expect(newHeightNum).not.toBeNaN();

		// Verify that the height changed
		expect(newHeightNum).not.toBe(initialHeightNum);

		// Verify the height changed in the expected direction
		if (parseInt(newLength) > parseInt(currentLength)) {
			// If length increased, height should increase
			expect(newHeightNum).toBeGreaterThan(initialHeightNum);
		} else {
			// If length decreased, height should decrease
			expect(newHeightNum).toBeLessThan(initialHeightNum);
		}

		// Verify the height matches the expected calculation
		// hourHeight default is 4em, so expected height = length * hourHeight
		const hourHeight = 4; // Default from timetable block
		const expectedHeight = parseInt(newLength) * hourHeight;
		expect(newHeightNum).toBe(expectedHeight * 16);

		// Also verify that the CSS custom property is updated
		const columnHeightProperty = await timeColumnBody.evaluate((el) => {
			return window
				.getComputedStyle(el)
				.getPropertyValue('--column-height');
		});
		expect(columnHeightProperty.trim()).toBe(`${expectedHeight}em`);
	});
});
