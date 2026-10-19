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

			// Source form and page (#1324): the block's form title names the
			// submission, and the published page it came from is linked.
			const infoRow = (label) =>
				info.locator('tr', {
					has: page.locator('th', {
						hasText: new RegExp(`^${label}$`),
					}),
				});
			await expect(
				page.locator('.fair-form-submission-detail h1')
			).toHaveText(seed.formTitle);
			await expect(infoRow('Form').locator('td')).toHaveText(
				seed.formTitle
			);
			const sourcePage = infoRow('Page').getByRole('link', {
				name: seed.pageTitle,
			});
			await expect(sourcePage).toHaveAttribute('href', seed.pageUrl);

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

	test.describe('date answers (#1937)', () => {
		// A browser timezone far from the site's: date answers are calendar
		// dates and date & time answers site-local wall clock values, so
		// neither offset may shift what is displayed.
		test.use({ timezoneId: 'America/Los_Angeles', locale: 'en-US' });

		const SITE_TIMEZONE = 'Asia/Tokyo';
		const DATE_TEXT = 'July 8, 2026';
		const DATETIME_TEXT = 'July 8, 2026 11:30 pm';

		test('renders populated and empty date answers like the responses view', async ({
			page,
		}) => {
			const pageErrors = [];
			page.on('pageerror', (err) => pageErrors.push(err.message));

			let seed;
			let previous;

			try {
				previous = runScript(
					'set-site-timezone.php',
					'E2E_SITE_TIMEZONE',
					SITE_TIMEZONE
				);
				seed = runScript(
					'seed-fair-form-date-answers.php',
					'E2E_FAIR_FORM_DATE_ANSWERS'
				);

				await loginAsAdmin(page);
				await page.goto(
					`${DETAIL_PAGE}&submission_id=${seed.submissionId}`
				);

				const answers = page.locator(
					'.fair-form-submission-detail__answers-table'
				);
				const answerCell = (question) =>
					answers
						.locator('tr', { hasText: question })
						.locator('td')
						.nth(1);

				await expect(answerCell('E2E Birthday')).toHaveText(DATE_TEXT);
				await expect(answerCell('E2E Arrival')).toHaveText(
					DATETIME_TEXT
				);
				await expect(answerCell('E2E Departure day')).toHaveText('—');
				await expect(answerCell('E2E Pickup time')).toHaveText('—');
				await expect(answerCell('E2E Dietary needs')).toHaveText(
					'Vegetarian'
				);

				// The questionnaire responses view formats the same answers.
				await page.goto(
					`/wp-admin/admin.php?page=fair-form-questionnaire-responses&post_id=${seed.pageId}`
				);
				const row = page.locator('tr', { hasText: 'Vegetarian' });
				await expect(row).toBeVisible({ timeout: 15000 });
				await expect(
					row.getByRole('cell', { name: DATE_TEXT, exact: true })
				).toBeVisible();
				await expect(
					row.getByRole('cell', { name: DATETIME_TEXT, exact: true })
				).toBeVisible();

				expect(pageErrors).toEqual([]);
			} finally {
				if (seed) {
					runScript(
						'cleanup-fair-form-notification-page.php',
						'E2E_FAIR_FORM_NOTIFICATION_CLEANUP',
						`${seed.pageId}`
					);
				}
				if (previous) {
					runScript(
						'set-site-timezone.php',
						'E2E_SITE_TIMEZONE',
						`${previous.timezoneString || '-'} ${previous.gmtOffset}`
					);
				}
			}
		});
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
