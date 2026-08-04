/**
 * Playwright API tests for the url-question "read event details from the
 * linked page" opt-in extraction (#1327): `QuestionnaireService::process_url_extractions()`
 * is a post-sanitize processing step in `FairFormController::create_item()`
 * that fetches a submitted url answer's address server-side (when the
 * submission carries `extract_event_details: true` on that answer) and
 * stores whatever event details it can read on `answer_meta`, surfaced back
 * as `event_details` by `QuestionnaireResponsesController`.
 *
 * Success/failure targets are real, stable external addresses rather than a
 * dedicated fixture page, mirroring `EventLookupController.api.spec.js`
 * (which already relies on a live fetch of https://example.com) — this repo's
 * existing convention for this kind of server-side-fetch integration test:
 *   - https://example.com has only a `<title>` (no schema.org/OpenGraph), so
 *     it exercises the full fetch → parse → persist → API pipeline via the
 *     title fallback, while the parser's schema.org/OpenGraph branches are
 *     already covered hermetically by
 *     fair-events/__tests__/Shared/PageMetadataParserTest.php.
 *   - example.test is an RFC 2606 reserved TLD guaranteed to never resolve,
 *     for the "unreachable" case.
 *   - 169.254.169.254 (the well-known cloud metadata address) is a private/
 *     link-local target wp_safe_remote_get() must reject, for the SSRF case.
 *   - https://api.github.com/zen returns a stable 200 text/plain response,
 *     for the "non-HTML" case.
 *
 * Every case carries its own unique email answer so the FairFormController
 * rate limiter (3/hour, keyed on email when present) keys per-submission.
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

const urlQuestion = (value, extractEventDetails) => ({
	question_key: 'website',
	question_text: 'Event page?',
	question_type: 'url',
	answer_value: value,
	display_order: 1,
	...(extractEventDetails !== undefined && {
		extract_event_details: extractEventDetails,
	}),
});

test.describe('FairFormController — url extraction opt-in (#1327)', () => {
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
			s.answers.some(
				(a) => a.question_type === 'email' && a.answer_value === email
			)
		);
	}

	async function ensureParticipant(email) {
		if (!fairAudienceActive) {
			return;
		}
		await api.post('/wp-json/fair-audience/v1/participants', {
			headers: adminHeaders,
			data: { name: 'URL Extraction Test', email },
		});
	}

	async function submitAndFindUrlAnswer(
		email,
		urlValue,
		extractEventDetails
	) {
		await ensureParticipant(email);
		const res = await api.post('/wp-json/fair-form/v1/fair-form-submit', {
			data: {
				post_id: postId,
				questionnaire_answers: [
					emailQuestion(email),
					urlQuestion(urlValue, extractEventDetails),
				],
			},
		});
		expect(res.ok()).toBeTruthy();

		const submission = await findSubmissionByEmail(email);
		expect(submission).toBeTruthy();
		return submission.answers.find((a) => a.question_key === 'website');
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

	test('captures details when extract_event_details is true and the page is reachable', async () => {
		const urlAnswer = await submitAndFindUrlAnswer(
			uniqueEmail('extract-success'),
			'https://example.com',
			true
		);

		expect(urlAnswer.answer_value).toBe('https://example.com');
		expect(urlAnswer.event_details).toBeTruthy();
		expect(urlAnswer.event_details.title).toBeTruthy();
	});

	test('omits event_details when extract_event_details is false', async () => {
		const urlAnswer = await submitAndFindUrlAnswer(
			uniqueEmail('extract-off'),
			'https://example.com',
			false
		);

		expect(urlAnswer.answer_value).toBe('https://example.com');
		expect(urlAnswer.event_details).toBeUndefined();
	});

	test('omits event_details when extract_event_details is not sent', async () => {
		const urlAnswer = await submitAndFindUrlAnswer(
			uniqueEmail('extract-unset'),
			'https://example.com',
			undefined
		);

		expect(urlAnswer.answer_value).toBe('https://example.com');
		expect(urlAnswer.event_details).toBeUndefined();
	});

	test('submission still succeeds with no event_details for an unreachable domain', async () => {
		const urlAnswer = await submitAndFindUrlAnswer(
			uniqueEmail('extract-unreachable'),
			'https://this-should-not-resolve.example.test',
			true
		);

		expect(urlAnswer.event_details).toBeUndefined();
	});

	test('submission still succeeds with no event_details for a private/internal address', async () => {
		const urlAnswer = await submitAndFindUrlAnswer(
			uniqueEmail('extract-private-ip'),
			'http://169.254.169.254/',
			true
		);

		expect(urlAnswer.event_details).toBeUndefined();
	});

	test('submission still succeeds with no event_details for a non-HTML response', async () => {
		const urlAnswer = await submitAndFindUrlAnswer(
			uniqueEmail('extract-non-html'),
			'https://api.github.com/zen',
			true
		);

		expect(urlAnswer.event_details).toBeUndefined();
	});
});
