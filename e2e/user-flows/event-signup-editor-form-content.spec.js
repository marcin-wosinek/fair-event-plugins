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
 *
 * The last test reopens content saved before a WordPress package upgrade
 * (#1815) and round-trips it through the editor, so a package major that
 * changes serialization or block validation shows up as a failure here.
 */

import { test, expect } from '../support/fixtures.js';
import { loginAsAdmin, wpCli } from '../support/wp-cli.js';

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

	test('question fields can be found and inserted from the appender (#1347)', async ({
		page,
		seedEvent,
	}) => {
		// A bare unified block — no pre-existing question — to prove insertion
		// itself works, not just rendering of already-nested questions.
		const event = seedEvent('free');

		await loginAsAdmin(page);
		await page.goto(`/wp-admin/post.php?post=${event.eventId}&action=edit`);

		const editorFrame = page.frameLocator('[name="editor-canvas"]');
		await editorFrame.locator('.block-editor-iframe__body').waitFor();

		const welcomeGuide = page.locator('.components-guide');
		if (await welcomeGuide.isVisible().catch(() => false)) {
			await page.getByRole('button', { name: 'Close' }).first().click();
		}

		const signupBlock = editorFrame.locator(
			'.wp-block-fair-events-event-signup'
		);
		await signupBlock.waitFor();

		// Wait until the Form content area is portaled into the SSR preview's
		// slot: the portal remounts the appender once the preview fetch
		// resolves, which would close an inserter opened before that.
		const questionsArea = signupBlock.locator(
			'.fair-events-event-signup-questions-slot .fair-events-event-signup-questions'
		);
		await questionsArea.waitFor();
		const appender = questionsArea.locator('.block-list-appender button');
		await appender.click();

		await page.fill(
			'.block-editor-inserter__search input',
			'Conditional Section'
		);
		await page.click(
			'.block-editor-block-types-list__item:has-text("Conditional Section")'
		);

		// The inserted question block lands inside the Form content area, not
		// somewhere else in the block tree, and remains selectable/configurable.
		const question = questionsArea.locator(
			'.wp-block-fair-form-fair-form-conditional'
		);
		await question.waitFor();
		await expect(question).toHaveClass(/is-selected/);
	});

	test('content saved before a package upgrade opens, edits, saves and reloads unchanged (#1815)', async ({
		page,
		seedEvent,
	}) => {
		// Markup as the editor serialized it before the WordPress package
		// upgrade: blocks from several plugins, non-default attributes, and
		// nested question/option blocks inside the Event Signup block.
		const event = seedEvent('free', { block: 'saved-editor-content' });
		const savedContent = () =>
			wpCli(`post get ${event.eventId} --field=post_content`).trim();
		const before = savedContent();

		const validationMessages = [];
		page.on('console', (message) => {
			if (/block validation/i.test(message.text())) {
				validationMessages.push(message.text());
			}
		});

		const invalidBlocks = () =>
			page.evaluate(() => {
				const editor = window.wp.data.select('core/block-editor');
				return editor
					.getClientIdsWithDescendants()
					.map((clientId) => editor.getBlock(clientId))
					.filter((block) => block && false === block.isValid)
					.map((block) => block.name);
			});

		const openEditor = async () => {
			await page.goto(
				`/wp-admin/post.php?post=${event.eventId}&action=edit`
			);
			const editorFrame = page.frameLocator('[name="editor-canvas"]');
			await editorFrame.locator('.block-editor-iframe__body').waitFor();
			const welcomeGuide = page.locator('.components-guide');
			if (await welcomeGuide.isVisible().catch(() => false)) {
				await page
					.getByRole('button', { name: 'Close' })
					.first()
					.click();
			}
			await editorFrame
				.locator('.wp-block-fair-events-event-signup')
				.waitFor();
			return editorFrame;
		};

		await loginAsAdmin(page);
		let editorFrame = await openEditor();

		expect(await invalidBlocks()).toEqual([]);
		await expect(editorFrame.locator('.block-editor-warning')).toHaveCount(
			0
		);

		// Edit the description, then save.
		const description = editorFrame.locator('p.wp-block-paragraph', {
			hasText: 'Synthetic event description.',
		});
		await description.click();
		await page.keyboard.press('End');
		await page.keyboard.type(' Edited.');
		await page.keyboard.press('ControlOrMeta+s');
		await page.waitForFunction(() => {
			const editor = window.wp.data.select('core/editor');
			return !editor.isSavingPost() && !editor.isEditedPostDirty();
		});

		// Only the edited paragraph changed: every other block keeps its
		// attributes and nested content byte for byte.
		const after = savedContent();
		expect(after).toBe(
			before.replace(
				'Synthetic event description.',
				'Synthetic event description. Edited.'
			)
		);

		editorFrame = await openEditor();
		expect(await invalidBlocks()).toEqual([]);
		await expect(editorFrame.locator('.block-editor-warning')).toHaveCount(
			0
		);
		await expect(
			editorFrame.locator('.wp-block-fair-events-event-signup')
		).toBeVisible();
		expect(validationMessages).toEqual([]);
	});
});
