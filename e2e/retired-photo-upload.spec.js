/**
 * Photo authors, photo tags and the participant photo upload page are
 * retired (#1689).
 *
 * Covers the upgrade cleanup on an installation that still has photo data
 * (including a repeated run), the 410 answer for old "Upload photos" links,
 * the retired REST routes, the media screens without photo fields, the
 * Photos bundle missing from the experimental settings, and a Fair Form file
 * upload that still stores its attachment.
 *
 * Run: `npm run test:e2e:local -- e2e/retired-photo-upload.spec.js`.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from './support/fixtures.js';
import { wpCli, runScript, loginAsAdmin } from './support/wp-cli.js';

const RETIRED_ROUTES = [
	'/fair-audience/v1/photo-upload',
	'/fair-audience/v1/photos/1/tags',
	'/fair-audience/v1/photos/1/tags/2',
	'/fair-audience/v1/photos/batch-tag',
];

const UPLOAD_LINK = '/?participant_token=e2eretiredtoken&photo_upload=1';

const GONE_TEXT = 'Photo uploads are no longer available.';

// A small JPEG shipped with fair-calendar-button.
const SAMPLE_IMAGE = fileURLToPath(
	new URL('../fair-calendar-button/assets/icon-128x128.jpg', import.meta.url)
);

/**
 * True iff WordPress has a route matching `path`, whatever methods it
 * accepts: OPTIONS answers a registered route with its schema and an
 * unregistered one with an empty array.
 */
async function routeIsRegistered(request, path) {
	const response = await request.fetch(`/wp-json${path}`, {
		method: 'OPTIONS',
	});
	const body = await response.json();
	return !Array.isArray(body);
}

/** Whether a dotted version is at least the given one. */
function versionAtLeast(version, minimum) {
	const a = String(version).split('.').map(Number);
	const b = minimum.split('.').map(Number);
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if ((a[i] || 0) !== (b[i] || 0)) {
			return (a[i] || 0) > (b[i] || 0);
		}
	}
	return true;
}

test.describe('Retired photo authors, tags and upload page', () => {
	test('upgrade removes photo data, keeps media and people, and can repeat', () => {
		const seed = runScript('seed-retired-photos.php', 'E2E_SEED');
		const ids = [seed.attachmentId, ...seed.participantIds].join(' ');

		try {
			// Any wp-cli call boots WordPress, which runs the pending upgrade.
			const state = runScript(
				'retired-photos-state.php',
				'E2E_STATE',
				ids
			);

			expect(state.photoTableExists).toBe(false);
			expect(state.bulkUploadMeta).toBe(0);
			expect(state.audienceFeatures).toEqual({ polls: true });
			expect(state.attachmentExists).toBe(true);
			expect(state.participants).toBe(2);
			expect(versionAtLeast(state.audienceDbVersion, '1.46.0')).toBe(
				true
			);

			// Rewind the version: the cleanup runs again over clean data.
			wpCli('option update fair_audience_db_version 1.45.0');

			const repeated = runScript(
				'retired-photos-state.php',
				'E2E_STATE',
				ids
			);
			expect(repeated).toEqual(state);
		} finally {
			runScript('cleanup-retired-photos.php', 'E2E_CLEANUP', ids);
		}
	});

	test('old upload links answer 410 without accepting files', async ({
		request,
	}) => {
		const response = await request.get(UPLOAD_LINK, { maxRedirects: 0 });
		expect(response.status()).toBe(410);
		expect(await response.text()).toContain(GONE_TEXT);

		const upload = await request.post(UPLOAD_LINK, {
			maxRedirects: 0,
			multipart: {
				photos: {
					name: 'photo.jpg',
					mimeType: 'image/jpeg',
					buffer: readFileSync(SAMPLE_IMAGE),
				},
			},
		});
		expect(upload.status()).toBe(410);
		expect(await upload.text()).toContain(GONE_TEXT);
	});

	test('photo upload and tagging REST routes are gone', async ({
		request,
	}) => {
		for (const path of RETIRED_ROUTES) {
			expect(
				await routeIsRegistered(request, path),
				`${path} should be unregistered`
			).toBe(false);
		}
	});

	test('media screens and settings have no photo author or tag controls', async ({
		page,
	}) => {
		const attachmentId = Number(
			wpCli(
				'media import wp-content/plugins/fair-calendar-button/assets/icon-128x128.jpg --title="E2E media photo" --porcelain'
			).trim()
		);

		try {
			await loginAsAdmin(page);

			await page.goto('/wp-admin/upload.php?mode=list');
			await expect(
				page.getByRole('link', { name: 'E2E media photo', exact: true })
			).toBeVisible();
			await expect(
				page.getByRole('columnheader', { name: 'Photo Author' })
			).toHaveCount(0);
			await expect(
				page.locator('select[name="fair_photo_author_filter"]')
			).toHaveCount(0);
			await expect(
				page.locator(
					'#bulk-action-selector-top option[value="fair_audience_set_author"]'
				)
			).toHaveCount(0);

			await page.goto('/wp-admin/media-new.php');
			await expect(page.locator('#plupload-upload-ui')).toBeVisible();
			await expect(page.getByText('Photo Author:')).toHaveCount(0);

			await page.goto(
				`/wp-admin/post.php?post=${attachmentId}&action=edit`
			);
			await expect(page.locator('#attachment_alt')).toBeVisible();
			await expect(page.getByText('Photo Author')).toHaveCount(0);
			await expect(page.getByText('Tagged People')).toHaveCount(0);

			await page.goto(
				'/wp-admin/admin.php?page=fair-audience-experimental-settings'
			);
			// Another bundle's toggle proves the list rendered.
			await expect(page.getByLabel('Image templates')).toBeVisible();
			await expect(
				page.getByLabel('Photos', { exact: true })
			).toHaveCount(0);
		} finally {
			wpCli(`post delete ${attachmentId} --force`);
		}
	});

	test('a Fair Form file upload still stores its attachment', async ({
		request,
	}) => {
		const formId = `e2e-photo-${Date.now()}`;
		const email = `${formId}@example.com`;

		const response = await request.post(
			'/wp-json/fair-form/v1/fair-form-submit',
			{
				multipart: {
					form_id: formId,
					form_title: 'E2E file upload',
					questionnaire_answers: JSON.stringify([
						{
							question_key: 'email',
							question_text: 'Email',
							question_type: 'email',
							answer_value: email,
						},
						{
							question_key: 'photo',
							question_text: 'Your photo',
							question_type: 'file_upload',
							answer_value: '',
						},
					]),
					fair_form_file_photo: {
						name: 'photo.jpg',
						mimeType: 'image/jpeg',
						buffer: readFileSync(SAMPLE_IMAGE),
					},
				},
			}
		);
		expect(response.status()).toBe(200);

		const state = runScript(
			'questionnaire-upload-state.php',
			'E2E_STATE',
			`${formId} cleanup`
		);
		expect(state.submissionFound).toBe(true);
		expect(state.participantId).toBeGreaterThan(0);
		expect(state.answerType).toBe('file_upload');
		expect(state.attachmentId).toBeGreaterThan(0);
		expect(state.attachmentExists).toBe(true);
		expect(state.fileExists).toBe(true);
		// No author record can exist: the table is gone.
		expect(state.photoTableExists).toBe(false);
	});
});
