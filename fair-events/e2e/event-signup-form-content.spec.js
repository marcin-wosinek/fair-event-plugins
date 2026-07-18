import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Regression for #1194: the Event Signup block's preview click-freeze also
 * disabled the "Form content" area's add-block control, making it impossible
 * to add extra questions/content there. The fix scopes the freeze to the
 * `.fair-events-get-tickets` preview only.
 */

test.describe('Event Signup block "Form content" area', () => {
	test.beforeEach(async ({ page }) => {
		await page.goto('/wp-admin');
		if (page.url().includes('wp-login.php')) {
			await page.fill('#user_login', WP_ADMIN_USER);
			await page.fill('#user_pass', WP_ADMIN_PASS);
			await page.click('#wp-submit');
		}
		await page.waitForSelector('#wpadminbar');
	});

	test('allows adding a block to the Form content area while the preview stays inert', async ({
		page,
	}) => {
		await page.goto('/wp-admin/post-new.php');

		const editorFrame = page.frameLocator('[name="editor-canvas"]');
		await editorFrame.locator('.block-editor-iframe__body').waitFor();
		await page.waitForTimeout(2000);

		// Insert the Event Signup block via the main inserter.
		await page.getByRole('button', { name: 'Block Inserter' }).click();
		await page.fill('.block-editor-inserter__search input', 'Event Signup');
		await page.click(
			'.block-editor-block-types-list__item:has-text("Event Signup")'
		);

		const signupBlock = editorFrame.locator(
			'.wp-block-fair-events-event-signup'
		);
		await signupBlock.waitFor();

		const closeInserterButton = page.getByRole('button', {
			name: 'Close Block Inserter',
		});
		if (await closeInserterButton.isVisible()) {
			await closeInserterButton.click();
			await page.waitForTimeout(500);
		}

		// The preview stays non-interactive: its submit button ignores clicks.
		const previewSubmit = signupBlock
			.locator('.fair-events-get-tickets button[type="submit"]')
			.first();
		if (await previewSubmit.count()) {
			await expect(previewSubmit).toHaveCSS('pointer-events', 'none');
		}

		// The "Form content" area's add-block appender is clickable and opens
		// the inserter.
		const questionsArea = signupBlock.locator(
			'.fair-events-event-signup-questions'
		);
		await questionsArea.waitFor();

		const appender = questionsArea.locator('.block-list-appender button');
		await appender.waitFor();
		await appender.click();

		await page.fill('.block-editor-inserter__search input', 'Paragraph');
		await page.click(
			'.block-editor-block-types-list__item:has-text("Paragraph")'
		);

		// The added paragraph lands inside the Form content area, and can be
		// typed into, selected, and removed like any other block.
		const paragraph = questionsArea.locator('p.wp-block-paragraph');
		await paragraph.waitFor();
		await paragraph.click();
		await paragraph.type('Extra question text');
		await expect(paragraph).toHaveText('Extra question text');
	});
});
