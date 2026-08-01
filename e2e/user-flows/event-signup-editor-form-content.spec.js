/**
 * E2E: the Event Signup block's "Form content" area stays interactive in the
 * block editor while the live ticket-purchase preview stays inert (#1344).
 *
 * `editor.js` portals the "Form content" InnerBlocks area into the same slot
 * `render.php` renders inside `.fair-events-get-tickets` for on-canvas
 * position matching against the frontend. Since `.fair-events-get-tickets`
 * carries a `pointer-events: none` rule to freeze the live preview, the
 * portaled appender and any already-nested question blocks inherited it too
 * and became unclickable. This only reproduces with a real resolvable event
 * date — a blank `post-new.php` never renders `.fair-events-get-tickets` at
 * all, so it can't catch this class of regression.
 */

import { test, expect } from '../support/fixtures.js';
import { loginAsAdmin } from '../support/wp-cli.js';

test.describe('Event Signup block "Form content" area in the editor', () => {
	test('appender and nested question stay interactive while the preview stays inert', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free', { block: 'unified-with-question' });

		await loginAsAdmin(page);
		await page.goto(`/wp-admin/post.php?post=${event.eventId}&action=edit`);

		const editorFrame = page.frameLocator('[name="editor-canvas"]');
		await editorFrame.locator('.block-editor-iframe__body').waitFor();

		// Dismiss the "Welcome to the block editor" guide it shows on a
		// user's first visit — it overlays the canvas and blocks clicks.
		const welcomeGuide = page.locator('.components-guide');
		if (await welcomeGuide.isVisible().catch(() => false)) {
			await page.getByRole('button', { name: 'Close' }).first().click();
		}

		const signupBlock = editorFrame.locator(
			'.wp-block-fair-events-event-signup'
		);
		await signupBlock.waitFor();

		// The live preview stays non-interactive: its submit button ignores
		// clicks, unchanged from today.
		const previewSubmit = signupBlock
			.locator('.fair-events-get-tickets button[type="submit"]')
			.first();
		await expect(previewSubmit).toHaveCSS('pointer-events', 'none');

		// The pre-existing nested question block remains selectable.
		const question = signupBlock.locator('.fair-form-question-short-text');
		await question.click();
		await expect(question).toHaveClass(/is-selected/);

		// The "Form content" area's add-block appender is clickable and opens
		// the inserter.
		const questionsArea = signupBlock.locator(
			'.fair-events-event-signup-questions'
		);
		const appender = questionsArea.locator('.block-list-appender button');
		await appender.click();

		await page.fill('.block-editor-inserter__search input', 'Paragraph');
		await page.click(
			'.block-editor-block-types-list__item:has-text("Paragraph")'
		);

		// The added paragraph lands inside the Form content area, and can be
		// typed into.
		const paragraph = questionsArea.locator('p.wp-block-paragraph');
		await paragraph.waitFor();
		await paragraph.click();
		await paragraph.type('Extra instructions');
		await expect(paragraph).toHaveText('Extra instructions');
	});
});
