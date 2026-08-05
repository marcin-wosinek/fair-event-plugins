/**
 * E2E: a URL question opted into "read event details from the linked page"
 * (#1327) shows a live preview bubble under the field as soon as the visitor
 * leaves it, fetched from the public, rate-limited
 * `/fair-form/v1/url-preview` endpoint. Nothing is written to the database —
 * the submission-detail admin page only ever shows the raw submitted URL.
 *
 * The target page is https://example.com — a real, always-available address
 * with no schema.org/OpenGraph markup, so it only yields a `<title>` fallback
 * ("Example Domain"). That's enough to exercise the full
 * frontend blur -> server-side fetch -> parse -> live preview pipeline; the
 * parser's schema.org/OpenGraph branches are already covered hermetically by
 * fair-events/__tests__/Shared/PageMetadataParserTest.php, and the preview's
 * client-side wiring (formatting, debouncing, failure handling, the
 * extractEventDetails-off case) is already covered by
 * fair-events-shared/src/__tests__/questionnaire.test.js.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from '../support/wp-cli.js';

const DETAIL_PAGE = '/wp-admin/admin.php?page=fair-form-submission-detail';

test.describe('Fair Form url question — read event details from the linked page', () => {
	// The preview endpoint rate-limits by IP.
	test.beforeEach(() => {
		wpCli('transient delete --all');
	});

	test('shows a live preview on blur, and does not persist it with the submission', async ({
		page,
	}) => {
		const submitterEmail = `e2e.url-extract.${Date.now()}@example.test`;

		const seed = runScript(
			'seed-fair-form-url-extraction-page.php',
			'E2E_FAIR_FORM_URL_EXTRACTION_PAGE'
		);
		let state = { found: false };

		try {
			await page.goto(seed.pageUrl);

			await page.fill(
				'[data-question-key="email"] input[type="email"]',
				submitterEmail
			);
			const websiteInput = page.locator(
				'[data-question-key="website"] input[type="text"]'
			);
			await websiteInput.fill('https://example.com');
			await websiteInput.blur();

			const websiteQuestion = page.locator(
				'[data-question-key="website"]'
			);
			await expect(
				websiteQuestion.getByText('Read from the linked page:')
			).toBeVisible();
			await expect(
				websiteQuestion.getByText('Example Domain')
			).toBeVisible();

			await page.click('.fair-form-submit-button');
			await expect(page.locator('.fair-form-message')).toHaveText(
				'Thank you for your submission!'
			);

			state = runScript(
				'fair-form-submission-state.php',
				'E2E_FAIR_FORM_SUBMISSION',
				`${seed.pageId}`
			);
			expect(state.found).toBe(true);

			await loginAsAdmin(page);
			await page.goto(
				`${DETAIL_PAGE}&submission_id=${state.submissionId}`
			);

			const answers = page.locator(
				'.fair-form-submission-detail__answers-table'
			);
			await expect(
				answers.getByText('https://example.com')
			).toBeVisible();
			await expect(
				answers.getByText('Read from the linked page:')
			).toHaveCount(0);
			await expect(answers.getByText('Example Domain')).toHaveCount(0);
		} finally {
			if (!state.found) {
				state = runScript(
					'fair-form-submission-state.php',
					'E2E_FAIR_FORM_SUBMISSION',
					`${seed.pageId}`
				);
			}

			runScript(
				'cleanup-fair-form-notification-page.php',
				'E2E_FAIR_FORM_NOTIFICATION_CLEANUP',
				`${seed.pageId}`
			);

			if (state.participantId) {
				runScript(
					'cleanup-participant.php',
					'E2E_PARTICIPANT_CLEANUP',
					`${state.participantId}`
				);
			}
		}
	});
});
