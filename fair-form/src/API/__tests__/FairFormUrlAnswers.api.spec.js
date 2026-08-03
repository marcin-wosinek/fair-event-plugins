/**
 * Playwright API tests for URL-question validation/normalization in
 * FairFormController::create_item() / QuestionnaireService::sanitize_answers()
 * (#1326): a bare domain (no scheme) is accepted and normalized to
 * `https://`, an already-schemed `http://`/`https://` value passes through
 * unchanged, and anything that isn't a well-formed `http`/`https` address
 * (a `javascript:`/`file:` value, or free text) is rejected.
 *
 * Every accept-case payload carries its own unique email answer so the
 * FairFormController rate limiter (3/hour, keyed on email when present) keys
 * per-submission instead of falling back to the shared IP key.
 *
 * When fair-audience is active, FairFormController opportunistically creates
 * a Participant from that email — but Participant::save() requires a
 * non-empty `name`, which the controller never supplies. Pre-creating each
 * accept case's participant via the admin API (name + email) sidesteps that
 * pre-existing gap so this spec stays focused on URL validation; reject
 * cases never reach participant creation (sanitize_answers() fails first).
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

function uniqueEmail(prefix) {
	return `${prefix}-${Date.now()}-${Math.floor(
		Math.random() * 1e6
	)}@example.test`;
}

const emailQuestion = (value) => ({
	question_key: 'email',
	question_text: 'Email?',
	question_type: 'email',
	answer_value: value,
	display_order: 0,
});

const urlQuestion = (value) => ({
	question_key: 'website',
	question_text: 'Website?',
	question_type: 'url',
	answer_value: value,
	display_order: 1,
});

const ACCEPT_CASES = [
	{ input: 'example.com', expected: 'https://example.com' },
	{ input: 'example.com/my-event', expected: 'https://example.com/my-event' },
	{ input: 'https://example.com', expected: 'https://example.com' },
	{ input: 'http://example.com', expected: 'http://example.com' },
];

const REJECT_CASES = [
	'javascript:alert(1)',
	'file:///etc/passwd',
	'just some free text',
	'',
];

test.describe('FairFormController — URL question validation (#1326)', () => {
	let api;
	let fairAudienceActive = false;
	const postId = Date.now();

	async function findSubmissionByEmail(email) {
		const res = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses',
			{
				headers: adminHeaders,
				params: { post_id: postId, title: 'Fair Form' },
			}
		);
		expect(res.ok()).toBeTruthy();
		const submissions = await res.json();
		return submissions.find((s) =>
			s.answers.some((a) => a.answer_value === email)
		);
	}

	async function ensureParticipant(email) {
		if (!fairAudienceActive) {
			return;
		}
		await api.post('/wp-json/fair-audience/v1/participants', {
			headers: adminHeaders,
			data: { name: 'URL Test', email },
		});
	}

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const pluginsRes = await api.get('/wp-json/wp/v2/plugins', {
			headers: adminHeaders,
		});
		if (pluginsRes.ok()) {
			const plugins = await pluginsRes.json();
			fairAudienceActive = plugins.some(
				(p) =>
					p.plugin?.includes('fair-audience') && p.status === 'active'
			);
		}
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	for (const { input, expected } of ACCEPT_CASES) {
		test(`normalizes ${JSON.stringify(input)} to ${expected}`, async () => {
			const email = uniqueEmail('url-accept');
			await ensureParticipant(email);
			const res = await api.post(
				'/wp-json/fair-form/v1/fair-form-submit',
				{
					data: {
						post_id: postId,
						questionnaire_answers: [
							emailQuestion(email),
							urlQuestion(input),
						],
					},
				}
			);
			expect(res.ok()).toBeTruthy();

			const submission = await findSubmissionByEmail(email);
			expect(submission).toBeTruthy();
			const urlAnswer = submission.answers.find(
				(a) => a.question_key === 'website'
			);
			expect(urlAnswer.answer_value).toBe(expected);
		});
	}

	// Empty (not required) should be accepted and stored empty, unlike the
	// other reject cases which are invalid values, not absent ones.
	test('accepts an empty, non-required URL answer', async () => {
		const email = uniqueEmail('url-empty');
		await ensureParticipant(email);
		const res = await api.post('/wp-json/fair-form/v1/fair-form-submit', {
			data: {
				post_id: postId,
				questionnaire_answers: [emailQuestion(email), urlQuestion('')],
			},
		});
		expect(res.ok()).toBeTruthy();

		const submission = await findSubmissionByEmail(email);
		expect(submission).toBeTruthy();
		const urlAnswer = submission.answers.find(
			(a) => a.question_key === 'website'
		);
		expect(urlAnswer.answer_value).toBe('');
	});

	for (const value of REJECT_CASES.filter((v) => v !== '')) {
		test(`rejects ${JSON.stringify(value)}`, async () => {
			const email = uniqueEmail('url-reject');
			const res = await api.post(
				'/wp-json/fair-form/v1/fair-form-submit',
				{
					data: {
						post_id: postId,
						questionnaire_answers: [
							emailQuestion(email),
							urlQuestion(value),
						],
					},
				}
			);
			expect(res.status()).toBe(400);
			expect((await res.json()).code).toBe('invalid_url');
		});
	}
});
