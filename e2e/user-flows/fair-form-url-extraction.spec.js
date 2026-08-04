/**
 * E2E: a URL question opted into "read event details from the linked page"
 * (#1327) fetches the submitted address server-side at submission time and
 * shows the captured details on the submission-detail admin page, marked as
 * read from the page rather than typed.
 *
 * The target page is https://example.com — a real, always-available address
 * with no schema.org/OpenGraph markup, so it only yields a `<title>` fallback
 * ("Example Domain"). That's enough to exercise the full
 * frontend submit -> server-side fetch -> parse -> storage -> admin detail
 * pipeline; the parser's schema.org/OpenGraph branches are already covered
 * hermetically by fair-events/__tests__/Shared/PageMetadataParserTest.php.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from '../support/wp-cli.js';

const DETAIL_PAGE = '/wp-admin/admin.php?page=fair-form-submission-detail';

test.describe('Fair Form url question — read event details from the linked page', () => {
	// The submit endpoint rate-limits 3 requests/hour, keyed on email.
	test.beforeEach(() => {
		wpCli('transient delete --all');
	});

	test('captures and displays details from a reachable page', async ({
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
			await page.fill(
				'[data-question-key="website"] input[type="text"]',
				'https://example.com'
			);

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
			).toBeVisible();
			await expect(answers.getByText('Example Domain')).toBeVisible();
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

	test('omits the "read from linked page" section when the toggle is off', async ({
		page,
	}) => {
		const submitterEmail = `e2e.url-extract-off.${Date.now()}@example.test`;

		// Reuse the standard (non-extraction) questions page — its url question
		// has extractEventDetails left at its off-by-default value.
		const seed = runScript(
			'seed-fair-form-questions-page.php',
			'E2E_FAIR_FORM_QUESTIONS_PAGE',
			'e2e-url-extract-off e2e-url-extract-off'
		);
		let state = { found: false };

		try {
			await page.goto(seed.pageUrl);

			await page.fill(
				'[data-question-key="full_name"] input[type="text"]',
				'No Extraction'
			);
			await page.fill(
				'[data-question-key="email"] input[type="email"]',
				submitterEmail
			);
			await page.selectOption(
				'[data-question-key="how_heard"] select',
				'A friend'
			);

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

			await expect(
				page.locator('.fair-form-submission-detail__event-details')
			).toHaveCount(0);
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
