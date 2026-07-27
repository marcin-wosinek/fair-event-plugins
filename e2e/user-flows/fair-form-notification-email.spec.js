/**
 * E2E: Fair Form admin notification, decoupled from participant creation (#1212).
 *
 * Before this ticket, the notification configured on the Fair Form block was
 * only sent when the submission produced a fair-audience participant — which
 * required BOTH fair-audience to be active AND the form itself to collect an
 * email address. A plain contact/interest form with no email question never
 * notified the site owner, silently.
 *
 * The recipient is now resolved server-side from the block's own
 * `notificationEmail`/`formId` attributes (fair-form's
 * FormNotificationService::resolve_notification_email(), reading
 * `post_content`) instead of a client-supplied request param, and the send
 * no longer depends on fair-audience. Answers are posted directly to the
 * REST endpoint — no inner question blocks are needed, since resolution only
 * reads the wrapper block's own attributes — and the deferred send is
 * flushed via WP-CLI cron before asserting on captured mail.
 */

import { test, expect } from '@playwright/test';
import { wpCli, runScript, resetCapturedMail } from '../support/wp-cli.js';

/**
 * POST questionnaire answers to the public fair-form-submit endpoint.
 *
 * @param {import('@playwright/test').Page} page    Playwright page (used for its request context).
 * @param {number}                          pageId   Seeded page id (post_id param).
 * @param {Array<object>}                   answers  questionnaire_answers payload.
 */
async function submitForm(page, pageId, answers) {
	const response = await page.request.post(
		'/wp-json/fair-form/v1/fair-form-submit',
		{
			data: {
				post_id: pageId,
				questionnaire_answers: answers,
			},
		}
	);
	expect(response.ok()).toBe(true);
}

const shortTextAnswer = () => [
	{
		question_key: 'how_heard',
		question_text: 'How did you hear about us?',
		question_type: 'short_text',
		answer_value: 'E2E test',
		display_order: 0,
	},
];

test.describe('Fair Form admin notification', () => {
	// The submit endpoint rate-limits (3/hour); most scenarios below have no
	// email answer and so share the same IP-keyed transient — must reset per
	// test, not per suite, or the third submission in a run gets 429'd.
	test.beforeEach(() => {
		wpCli('transient delete --all');
		resetCapturedMail();
	});

	test('sends the notification when the form has no email question', async ({
		page,
	}) => {
		const notificationEmail = `notify.noemail.${Date.now()}@example.test`;
		const seed = runScript(
			'seed-fair-form-notification-page.php',
			'E2E_FAIR_FORM_NOTIFICATION_PAGE',
			notificationEmail
		);

		await submitForm(page, seed.pageId, shortTextAnswer());
		wpCli('cron event run --due-now');

		const state = runScript(
			'fair-form-notification-state.php',
			'E2E_FORM_NOTIFICATION',
			notificationEmail
		);
		expect(state.mail.length).toBe(1);
		expect(state.mail[0].subject).toContain('New form submission');

		runScript(
			'cleanup-fair-form-notification-page.php',
			'E2E_FAIR_FORM_NOTIFICATION_CLEANUP',
			`${seed.pageId}`
		);
	});

	test('sends both the notification and the submitter confirmation when the form has an email question', async ({
		page,
	}) => {
		const stamp = Date.now();
		const notificationEmail = `notify.withemail.${stamp}@example.test`;
		const submitterEmail = `submitter.${stamp}@example.test`;
		const seed = runScript(
			'seed-fair-form-notification-page.php',
			'E2E_FAIR_FORM_NOTIFICATION_PAGE',
			notificationEmail
		);

		await submitForm(page, seed.pageId, [
			{
				question_key: 'email',
				question_text: 'Your email',
				question_type: 'email',
				answer_value: submitterEmail,
				display_order: 0,
			},
		]);
		wpCli('cron event run --due-now');

		const notification = runScript(
			'fair-form-notification-state.php',
			'E2E_FORM_NOTIFICATION',
			notificationEmail
		);
		expect(notification.mail.length).toBe(1);
		expect(notification.mail[0].subject).toContain('New form submission');

		const confirmation = runScript(
			'fair-form-notification-state.php',
			'E2E_FORM_NOTIFICATION',
			submitterEmail
		);
		expect(confirmation.mail.length).toBeGreaterThan(0);

		runScript(
			'cleanup-fair-form-notification-page.php',
			'E2E_FAIR_FORM_NOTIFICATION_CLEANUP',
			`${seed.pageId}`
		);
	});

	test('sends nothing when the notification email is empty', async ({
		page,
	}) => {
		const seed = runScript(
			'seed-fair-form-notification-page.php',
			'E2E_FAIR_FORM_NOTIFICATION_PAGE',
			''
		);

		await submitForm(page, seed.pageId, shortTextAnswer());
		wpCli('cron event run --due-now');

		const state = runScript(
			'fair-form-notification-state.php',
			'E2E_FORM_NOTIFICATION'
		);
		expect(state.mail.length).toBe(0);

		runScript(
			'cleanup-fair-form-notification-page.php',
			'E2E_FAIR_FORM_NOTIFICATION_CLEANUP',
			`${seed.pageId}`
		);
	});

	test('sends nothing when the page has no Fair Form block', async ({
		page,
	}) => {
		const seed = runScript(
			'seed-fair-form-notification-page.php',
			'E2E_FAIR_FORM_NOTIFICATION_PAGE',
			`unused.${Date.now()}@example.test '' 1`
		);

		await submitForm(page, seed.pageId, shortTextAnswer());
		wpCli('cron event run --due-now');

		const state = runScript(
			'fair-form-notification-state.php',
			'E2E_FORM_NOTIFICATION'
		);
		expect(state.mail.length).toBe(0);

		runScript(
			'cleanup-fair-form-notification-page.php',
			'E2E_FAIR_FORM_NOTIFICATION_CLEANUP',
			`${seed.pageId}`
		);
	});
});
