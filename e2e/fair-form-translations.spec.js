/**
 * Fair Form's public form and block editor are translated (#1872), whichever
 * way the translations reach the site — a WordPress.org language pack in
 * wp-content/languages/plugins/ or the opt-in bundled catalog — and stay in
 * English on an English site.
 *
 * The block strings used to sit in Fair Audience's catalog, which isn't
 * loaded for Fair Form's blocks, so they rendered in English on a translated
 * site. The seeded form is stored under the legacy fair-audience/fair-form*
 * block names (#1161), so each case also reopens and submits an existing form
 * with a file upload, and checks the editor converts it to the fair-form/*
 * names.
 *
 * The `translation-delivery.php` fixture sets the site locale and copies the
 * plugin's own es_ES catalog to the language-pack location, so the spec
 * needs a current `npm run makemo` and `npm run build` in fair-form.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from './support/wp-cli.js';

const SAMPLE_IMAGE = fileURLToPath(
	new URL('../fair-calendar-button/assets/icon-128x128.jpg', import.meta.url)
);

const TEXT = {
	en: {
		// Rendered by PHP.
		maxFileSize: 'Max file size: 5 MB',
		// Shown by the frontend script.
		required: 'Please answer the required question: Your name',
		// Block editor: canvas placeholder, inspector panel and block title.
		answerPlaceholder: 'Type your answer...',
		settingsPanel: 'Question Settings',
		blockTitle: 'Short Text Question',
	},
	es: {
		maxFileSize: 'Tamaño máximo de archivo: 5 MB',
		required: 'Por favor, responde la pregunta requerida: Your name',
		answerPlaceholder: 'Escribe tu respuesta...',
		settingsPanel: 'Configuración de la pregunta',
		blockTitle: 'Pregunta de texto corto',
	},
};

const setDelivery = (mode, locale = 'es_ES') =>
	runScript(
		'translation-delivery.php',
		'E2E_TRANSLATIONS',
		`${mode} ${locale} fair-form`
	);

let seeded = null;

async function expectPublicForm(page, text) {
	await page.goto(seeded.pageUrl);
	const form = page.locator('.fair-form-form');
	await expect(
		form.locator('.fair-form-file-upload-help', {
			hasText: text.maxFileSize,
		})
	).toBeVisible();

	await form.locator('.fair-form-submit-button').click();
	await expect(form.locator('.fair-form-message')).toHaveText(text.required);

	await form.getByLabel('Your name').fill('E2E Translations');
	await form
		.getByLabel('Your email')
		.fill(`${seeded.formId}-${Date.now()}@example.com`);
	await form.getByLabel('Your photo').setInputFiles({
		name: 'photo.jpg',
		mimeType: 'image/jpeg',
		buffer: readFileSync(SAMPLE_IMAGE),
	});
	await form.locator('.fair-form-submit-button').click();
	await expect(form.locator('.fair-form-message')).toHaveText(
		'Thank you for your submission!'
	);

	const state = runScript(
		'questionnaire-upload-state.php',
		'E2E_STATE',
		`${seeded.formId} cleanup`
	);
	expect(state.submissionFound).toBe(true);
	expect(state.answerType).toBe('file_upload');
	expect(state.attachmentExists).toBe(true);
}

async function expectEditor(page, text) {
	await loginAsAdmin(page);
	await page.goto(`/wp-admin/post.php?post=${seeded.pageId}&action=edit`);

	const editorFrame = page.frameLocator('[name="editor-canvas"]');
	await editorFrame.locator('.block-editor-iframe__body').waitFor();

	const welcomeGuide = page.locator('.components-guide');
	if (await welcomeGuide.isVisible().catch(() => false)) {
		await page.getByRole('button', { name: 'Close' }).first().click();
	}

	const shortText = editorFrame.locator('.fair-form-question-short-text');
	await expect(
		shortText.getByPlaceholder(text.answerPlaceholder)
	).toBeVisible({ timeout: 20_000 });
	// The saved fair-audience/* blocks load without a recovery warning and
	// turn into the canonical fair-form/* blocks, nested ones included.
	await expect(editorFrame.locator('.block-editor-warning')).toHaveCount(0);
	await expect
		.poll(() =>
			page.evaluate(() => {
				const names = [];
				const collect = (blocks) =>
					blocks.forEach((block) => {
						names.push(block.name);
						collect(block.innerBlocks);
					});
				// eslint-disable-next-line no-undef
				collect(wp.data.select('core/block-editor').getBlocks());
				return names;
			})
		)
		.toEqual([
			'fair-form/fair-form',
			'fair-form/fair-form-short-text',
			'fair-form/fair-form-email',
			'fair-form/fair-form-file-upload',
		]);

	await shortText.click();
	await expect(
		page.locator('.block-editor-block-card__title', {
			hasText: text.blockTitle,
		})
	).toBeVisible();
	await expect(
		page.getByRole('button', { name: text.settingsPanel })
	).toBeVisible();
}

test.describe('Fair Form translations', () => {
	test.setTimeout(120_000);

	test.beforeAll(() => {
		setDelivery('reset');
		seeded = runScript(
			'seed-fair-form-translations-page.php',
			'E2E_FAIR_FORM_TRANSLATIONS_PAGE',
			`e2e-translations-${Date.now()}`
		);
	});

	test.afterAll(() => {
		setDelivery('reset');
		if (seeded) {
			runScript(
				'questionnaire-upload-state.php',
				'E2E_STATE',
				`${seeded.formId} cleanup`
			);
			wpCli(`post delete ${seeded.pageId} --force`);
		}
	});

	for (const mode of ['language-pack', 'bundled']) {
		test(`Spanish form and editor from the ${mode} catalog`, async ({
			page,
		}) => {
			const result = setDelivery(mode);
			expect(result.plugin).toBe('fair-form');

			await expectPublicForm(page, TEXT.es);
			await expectEditor(page, TEXT.es);
		});
	}

	test('English form and editor on an English site', async ({ page }) => {
		setDelivery('reset');

		await expectPublicForm(page, TEXT.en);
		await expectEditor(page, TEXT.en);
	});
});
