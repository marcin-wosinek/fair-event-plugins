/**
 * E2E: Select One and Multiselect questions whose choices come from post
 * categories (#1999).
 *
 * The seed builds a small category tree and two posts using it — a page with
 * a standalone Fair Form and a free event whose Event Signup nests the same
 * kind of question — so the real render callbacks, the shared frontend
 * validation and conditional logic, and the submit endpoint all run.
 *
 * The tests run in order: the rename/delete test changes the seeded
 * categories after the submission test has stored answers naming them, and
 * the editor test rewrites the page last.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from '../support/wp-cli.js';

const choicesOf = (page, key) =>
	page
		.locator(
			`[data-question-key="${key}"] option:not([value=""]), [data-question-key="${key}"] input[type="checkbox"]`
		)
		.evaluateAll((els) => els.map((el) => el.value));

test.describe.serial('Fair Form category-based choices', () => {
	let seed;
	let names;

	test.beforeAll(() => {
		seed = runScript(
			'seed-fair-form-category-options.php',
			'E2E_FAIR_FORM_CATEGORY_OPTIONS'
		);
		names = seed.categoryNames;
	});

	test.afterAll(() => {
		if (!seed) {
			return;
		}
		runScript(
			'cleanup-fair-form-notification-page.php',
			'E2E_FAIR_FORM_NOTIFICATION_CLEANUP',
			`${seed.pageId}`
		);
		runScript(
			'cleanup-event.php',
			'E2E_CLEANUP',
			`${seed.eventId} ${seed.eventDateId}`
		);
		wpCli(
			`term delete category ${Object.values(seed.categoryIds).join(' ')}`,
			{ allowFailure: true }
		);
	});

	test.beforeEach(() => {
		// The submit endpoint rate-limits 3 requests/hour, keyed on the IP
		// for a form without an email question.
		wpCli('transient delete --all');
	});

	test('renders the configured category scope in a standalone form', async ({
		page,
	}) => {
		await page.goto(seed.pageUrl);

		// Every descendant of the parent, alphabetical, excluding the parent
		// and ignoring the typed option kept in the block.
		const scope = [names.alpha, names.beta, names.gamma];
		expect(await choicesOf(page, 'workshop')).toEqual(scope);
		expect(await choicesOf(page, 'topics')).toEqual(scope);

		// An empty group and a deleted parent render no choices and say so,
		// never falling back to unrelated categories.
		for (const key of ['empty_group', 'missing_parent']) {
			const question = page.locator(`[data-question-key="${key}"]`);
			expect(await choicesOf(page, key)).toEqual([]);
			await expect(
				question.locator('.fair-form-question-empty')
			).toHaveText('There are no choices to pick from yet.');
		}

		// "All categories" includes parents, empty categories and the
		// default category.
		const all = await choicesOf(page, 'any_category');
		for (const name of [
			names.parent,
			names.alpha,
			names.gamma,
			names.empty,
			'Uncategorized',
		]) {
			expect(all).toContain(name);
		}
		expect(all).toEqual(
			[...all].sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: 'base' })
			)
		);
	});

	test('validates, reveals conditional fields and stores category names', async ({
		page,
	}) => {
		await page.goto(seed.pageUrl);
		const message = page.locator('.fair-form-message');
		const alphaNote = page.locator('[data-question-key="alpha_note"]');

		await page.click('.fair-form-submit-button');
		await expect(message).toContainText(
			'Please answer the required question'
		);

		await expect(alphaNote).toBeHidden();
		await page.selectOption(
			'[data-question-key="workshop"] select',
			names.alpha
		);
		await expect(alphaNote).toBeVisible();
		await alphaNote.locator('input').fill('Bring juggling balls');

		// The required multiselect still blocks submission while empty.
		await page.click('.fair-form-submit-button');
		await expect(message).toContainText('Which topics?');

		const topics = page.locator('[data-question-key="topics"]');
		await topics.getByLabel(names.beta).check();
		await topics.getByLabel(names.gamma).check();

		await page.click('.fair-form-submit-button');
		await expect(message).toHaveText('Thank you for your submission!');

		const state = runScript(
			'fair-form-submission-state.php',
			'E2E_FAIR_FORM_SUBMISSION',
			`${seed.pageId}`
		);
		expect(state.answers.workshop).toBe(names.alpha);
		expect(JSON.parse(state.answers.topics)).toEqual([
			names.beta,
			names.gamma,
		]);
		expect(state.answers.alpha_note).toBe('Bring juggling balls');
	});

	test('follows renamed and deleted categories while stored answers stay readable', async ({
		page,
	}) => {
		const renamed = `${names.alpha} renamed`;
		wpCli(
			`term update category ${seed.categoryIds.alpha} --name="${renamed}"`
		);
		wpCli(`term delete category ${seed.categoryIds.gamma}`);

		try {
			await page.goto(seed.pageUrl);
			expect(await choicesOf(page, 'topics')).toEqual([
				renamed,
				names.beta,
			]);

			const state = runScript(
				'fair-form-submission-state.php',
				'E2E_FAIR_FORM_SUBMISSION',
				`${seed.pageId}`
			);
			expect(state.answers.workshop).toBe(names.alpha);
			expect(JSON.parse(state.answers.topics)).toEqual([
				names.beta,
				names.gamma,
			]);

			await loginAsAdmin(page);
			await page.goto(
				`/wp-admin/admin.php?page=fair-form-submission-detail&submission_id=${state.submissionId}`
			);
			const answers = page.locator(
				'.fair-form-submission-detail__answers-table'
			);
			await expect(answers.getByText(names.alpha)).toBeVisible();
			await expect(answers.getByText(names.gamma)).toBeVisible();
		} finally {
			// Restore the name so the event signup test sees the original
			// scope.
			wpCli(
				`term update category ${seed.categoryIds.alpha} --name="${names.alpha}"`
			);
		}
	});

	test('works inside an Event Signup with conditional fields', async ({
		page,
	}) => {
		await page.goto(seed.eventUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		expect(await choicesOf(form, 'signup_topics')).toEqual([
			names.alpha,
			names.beta,
		]);

		const note = form.locator('[data-question-key="signup_alpha_note"]');
		const topics = form.locator('[data-question-key="signup_topics"]');
		await expect(note).toBeHidden();
		await topics.getByLabel(names.alpha).check();
		await expect(note).toBeVisible();
		await topics.getByLabel(names.alpha).uncheck();
		await expect(note).toBeHidden();
	});

	test('keeps the source, parent and typed options through save and reopen', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		const editUrl = `/wp-admin/post.php?post=${seed.pageId}&action=edit`;
		await page.goto(editUrl);

		const editorFrame = page.frameLocator('[name="editor-canvas"]');
		await editorFrame.locator('.block-editor-iframe__body').waitFor();
		const welcomeGuide = page.locator('.components-guide');
		if (await welcomeGuide.isVisible().catch(() => false)) {
			await page.getByRole('button', { name: 'Close' }).first().click();
		}

		// The first multiselect on the page is the "topics" question.
		const preview = editorFrame
			.locator('.fair-form-question-multiselect')
			.first();
		await expect(preview).toBeVisible();
		await expect(preview.getByText(names.alpha)).toBeVisible();
		await expect(
			preview.getByText('Your 1 typed option is kept.', {
				exact: false,
			})
		).toBeVisible();
		await preview.locator('textarea').click();

		const source = page.getByLabel('Where do the choices come from?');
		await expect(source).toHaveValue('categoryChildren');
		await expect(page.getByLabel('Parent category')).toHaveValue(
			names.parent
		);

		// Back to typed options: the kept option block reappears.
		await source.selectOption('manual');
		await expect(preview.locator('.fair-form-option-input')).toHaveValue(
			'Typed topic'
		);

		await page.getByRole('button', { name: 'Save', exact: true }).click();
		await page.waitForFunction(() => {
			const editor = window.wp.data.select('core/editor');
			return !editor.isSavingPost() && !editor.isEditedPostDirty();
		});

		await page.goto(editUrl);
		await editorFrame.locator('.block-editor-iframe__body').waitFor();
		const saved = await page.evaluate(() => {
			const find = (blocks) => {
				for (const block of blocks) {
					if (block.attributes?.questionKey === 'topics') {
						return block;
					}
					const nested = find(block.innerBlocks || []);
					if (nested) {
						return nested;
					}
				}
				return null;
			};
			const block = find(
				window.wp.data.select('core/block-editor').getBlocks()
			);
			return {
				optionSource: block.attributes.optionSource,
				parentCategoryId: block.attributes.parentCategoryId,
				options: block.innerBlocks.map((b) => b.attributes.value),
			};
		});
		expect(saved).toEqual({
			optionSource: 'manual',
			parentCategoryId: seed.categoryIds.parent,
			options: ['Typed topic'],
		});
	});
});
