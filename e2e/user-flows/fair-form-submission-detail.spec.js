/**
 * E2E: a Fair Form submitted from the frontend must render faithfully on the
 * submission-detail admin page (#619).
 *
 * This is the cross-plugin seam nothing else covers: the existing
 * `fair-form-standalone-responses.spec.js` opens the same page, but from a
 * DB-seeded submission. Here the data travels the whole way — rendered block
 * -> public REST submit -> questionnaire storage -> participant auto-creation
 * -> `GET /fair-form/v1/questionnaire-responses/{id}` -> the React detail view
 * — so a break anywhere along it fails the test.
 *
 * The submission id is resolved server-side via WP-CLI: the submit endpoint
 * deliberately returns only `{success, message}`.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from '../support/wp-cli.js';

const DETAIL_PAGE = '/wp-admin/admin.php?page=fair-form-submission-detail';

test.describe('Fair Form submission detail', () => {
	// The submit endpoint rate-limits 3 requests/hour. The email below is
	// unique per run, but the IP-keyed fallback and CI retries are not, so
	// clear transients the same way the notification suite does.
	test.beforeEach(() => {
		wpCli('transient delete --all');
	});

	test('renders every submitted answer and the submission metadata', async ({
		page,
	}) => {
		const submitterEmail = `e2e.detail.${Date.now()}@example.test`;
		const submitterName = 'Detail Tester';
		const choice = 'Social media';

		const seed = runScript(
			'seed-fair-form-questions-page.php',
			'E2E_FAIR_FORM_QUESTIONS_PAGE'
		);
		let state = { found: false };

		try {
			await page.goto(seed.pageUrl);

			await page.fill(
				'[data-question-key="full_name"] input[type="text"]',
				submitterName
			);
			await page.fill(
				'[data-question-key="email"] input[type="email"]',
				submitterEmail
			);
			await page.selectOption(
				'[data-question-key="how_heard"] select',
				choice
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
			expect(state.answerCount).toBe(3);
			expect(state.participantId).toBeGreaterThan(0);

			await loginAsAdmin(page);
			await page.goto(
				`${DETAIL_PAGE}&submission_id=${state.submissionId}`
			);

			const answers = page.locator(
				'.fair-form-submission-detail__answers-table'
			);
			await expect(
				answers.getByText(seed.questions.full_name)
			).toBeVisible();
			await expect(answers.getByText(submitterName)).toBeVisible();
			await expect(answers.getByText(seed.questions.email)).toBeVisible();
			await expect(answers.getByText(submitterEmail)).toBeVisible();
			await expect(
				answers.getByText(seed.questions.how_heard)
			).toBeVisible();
			await expect(answers.getByText(choice)).toBeVisible();

			// Submission Info: the email answer auto-creates a participant, and
			// "Submitted by" must link to it.
			const info = page.locator(
				'.fair-form-submission-detail__info-table'
			);
			const submittedBy = info.locator('tr', {
				hasText: 'Submitted by',
			});
			await expect(
				submittedBy.locator(
					`a[href*="participant_id=${state.participantId}"]`
				)
			).toBeVisible();

			await expect(
				info.locator('tr', { hasText: 'Email' }).locator('td')
			).toHaveText(submitterEmail);

			// formatDate() goes through toLocaleString(), so the exact text is
			// locale/timezone dependent — assert only that a date rendered.
			const dateCell = info
				.locator('tr', { hasText: 'Date' })
				.locator('td');
			await expect(dateCell).not.toHaveText('');
			await expect(dateCell).not.toHaveText('—');
		} finally {
			// A failure before the state read still leaves rows behind — look
			// the submission up again so teardown stays complete.
			if (!state.found) {
				state = runScript(
					'fair-form-submission-state.php',
					'E2E_FAIR_FORM_SUBMISSION',
					`${seed.pageId}`
				);
			}

			// Generic in the page id -> submissions/answers direction, so it
			// serves this seed too; the auto-created participant is not tied to
			// the page and needs its own teardown.
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

	test('shows a not-found notice for an unknown submission id', async ({
		page,
	}) => {
		const pageErrors = [];
		page.on('pageerror', (err) => pageErrors.push(err.message));

		await loginAsAdmin(page);
		await page.goto(`${DETAIL_PAGE}&submission_id=999999`);

		// Scoped to the notice: @wordpress/a11y mirrors the same string into the
		// off-screen speak region, which makes an unscoped getByText ambiguous.
		await expect(
			page.locator(
				'.fair-form-submission-detail .components-notice__content'
			)
		).toHaveText('Submission not found.');

		const body = await page.locator('body').innerText();
		expect(body).not.toContain('Fatal error');
		expect(body).not.toContain('Warning:');
		expect(pageErrors).toEqual([]);
	});
});
