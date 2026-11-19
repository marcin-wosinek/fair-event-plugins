/**
 * E2E: the Fair Form block's sidebar Event selector shows readable event
 * names (#2408).
 *
 * The options come from /fair-audience/v1/custom-mail/events, whose
 * `display_label` joins the stored, HTML-encoded post title with the
 * formatted date. The selector decodes that label once, so `&nbsp;`, quotes
 * and `&amp;` read as text and encoded HTML-like titles stay literal text.
 * Selecting an event, saving and reopening keeps the numeric event-date ID.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from '../support/wp-cli.js';

const NBSP = ' ';

test.describe('Fair Form block event selector', () => {
	let seed;

	test.beforeEach(() => {
		seed = runScript(
			'seed-fair-form-event-selector.php',
			'E2E_FAIR_FORM_EVENT_SELECTOR'
		);
	});

	test.afterEach(() => {
		if (!seed) {
			return;
		}
		for (const event of Object.values(seed.events)) {
			runScript(
				'cleanup-event.php',
				'E2E_CLEANUP',
				`${event.eventId} ${event.eventDateId}`
			);
		}
		wpCli(`post delete ${seed.pageId} --force`);
	});

	/**
	 * Open the seeded page, select its Fair Form block and return the
	 * sidebar's Event select once its options have loaded.
	 *
	 * @param {import('@playwright/test').Page} page Playwright page.
	 * @return {Promise<import('@playwright/test').Locator>} The Event select.
	 */
	async function openEventSelect(page) {
		await page.goto(`/wp-admin/post.php?post=${seed.pageId}&action=edit`);
		const editorFrame = page.frameLocator('[name="editor-canvas"]');
		await editorFrame.locator('.block-editor-iframe__body').waitFor();

		const welcomeGuide = page.locator('.components-guide');
		if (await welcomeGuide.isVisible().catch(() => false)) {
			await page.getByRole('button', { name: 'Close' }).first().click();
		}

		await page.waitForFunction(
			() =>
				window.wp.data.select('core/block-editor').getBlocks().length >
				0
		);
		await page.evaluate(() => {
			const [block] = window.wp.data
				.select('core/block-editor')
				.getBlocks();
			window.wp.data
				.dispatch('core/block-editor')
				.selectBlock(block.clientId);
			window.wp.data
				.dispatch('core/edit-post')
				.openGeneralSidebar('edit-post/block');
		});

		const select = page.getByRole('combobox', {
			name: 'Event',
			exact: true,
		});
		const firstSeeded = String(seed.events.nbsp.eventDateId);
		await expect(
			select.locator(`option[value="${firstSeeded}"]`)
		).toHaveCount(1);
		return select;
	}

	const optionText = (select, eventDateId) =>
		select.locator(`option[value="${eventDateId}"]`).textContent();

	test('shows decoded names and keeps the selection after save and reload', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		let select = await openEventSelect(page);

		const { nbsp, quoted } = seed.events;
		const stamp = nbsp.storedTitle.split(' ')[2];

		const nbspLabel = await optionText(select, nbsp.eventDateId);
		expect(
			nbspLabel.startsWith(`E2E Selector ${stamp} Test${NBSP}event (`)
		).toBe(true);

		const quotedTitle = `E2E Selector ${stamp} Minifesti “La${NBSP}Mutable” & <b>Friends</b>`;
		const quotedLabel = await optionText(select, quoted.eventDateId);
		expect(quotedLabel.startsWith(`${quotedTitle} (`)).toBe(true);

		// The date/time suffix survives unchanged, and no entity is left.
		for (const label of [nbspLabel, quotedLabel]) {
			expect(label).toMatch(/ \(.+\)$/);
			expect(label).not.toMatch(/&(?:nbsp|amp|lt|gt|#\d+);/);
		}

		// HTML-like titles stay text: no element was created in the option.
		await expect(
			select.locator(`option[value="${quoted.eventDateId}"] b`)
		).toHaveCount(0);

		await select.selectOption(String(quoted.eventDateId));
		await page.keyboard.press('ControlOrMeta+s');
		await page.waitForFunction(() => {
			const editor = window.wp.data.select('core/editor');
			return !editor.isSavingPost() && !editor.isEditedPostDirty();
		});

		const content = wpCli(`post get ${seed.pageId} --field=post_content`);
		expect(content).toContain(`"eventDateId":${quoted.eventDateId}`);

		select = await openEventSelect(page);
		await expect(select).toHaveValue(String(quoted.eventDateId));
		expect(
			await select.evaluate(
				(el) => el.options[el.selectedIndex].textContent
			)
		).toBe(quotedLabel);
	});
});
