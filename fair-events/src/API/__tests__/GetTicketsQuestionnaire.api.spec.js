/**
 * Playwright API tests for GetTicketsController accepting and persisting
 * custom-question `questionnaire_answers` on the anonymous signup route
 * (#1181, Layer 2). Answers are parsed/sanitized/persisted via fair-form's
 * QuestionnaireService, mirroring fair-audience's EventSignupController.
 *
 * Skips gracefully when fair-form is not active in the test environment
 * (answers are ignored, not rejected, when fair-form is inactive — covered
 * by the last test below, which runs regardless).
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

const nameQuestion = (value) => ({
	question_key: 'favorite_color',
	question_text: 'Favorite color?',
	question_type: 'short_text',
	answer_value: value,
	display_order: 0,
});

const phoneQuestion = (value) => ({
	question_key: 'phone',
	question_text: 'Phone number?',
	question_type: 'phone',
	answer_value: value,
	display_order: 1,
});

test.describe('GetTicketsController — questionnaire_answers', () => {
	let api;
	let fairFormActive = false;
	let fairAudienceActive = false;
	let eventPostId;
	let eventDateId;

	async function countSignups(eventDateIdToCount) {
		const res = await api.get('/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateIdToCount },
		});
		expect(res.ok()).toBeTruthy();
		return (await res.json()).length;
	}

	async function findSubmission(email) {
		const res = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses',
			{
				headers: adminHeaders,
				params: { event_date_id: eventDateId, title: 'Event Signup' },
			}
		);
		expect(res.ok()).toBeTruthy();
		const submissions = await res.json();
		return submissions.find((s) =>
			s.answers.some((a) => a.answer_value === email)
		);
	}

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const pluginsRes = await api.get('/wp-json/wp/v2/plugins', {
			headers: adminHeaders,
		});
		if (pluginsRes.ok()) {
			const plugins = await pluginsRes.json();
			fairFormActive = plugins.some(
				(p) => p.plugin?.includes('fair-form') && p.status === 'active'
			);
			fairAudienceActive = plugins.some(
				(p) =>
					p.plugin?.includes('fair-audience') && p.status === 'active'
			);
		}

		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets questionnaire test ${Date.now()}`,
				status: 'publish',
			},
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				event_id: eventPostId,
				start_datetime: '2035-06-01 10:00:00',
				end_datetime: '2035-06-01 12:00:00',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		eventDateId = (await edRes.json()).id;
	});

	test.afterAll(async () => {
		if (eventPostId) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${eventPostId}?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	});

	test('answers are stored with participant_id 0 (anonymous) when fair-audience is inactive', async () => {
		test.skip(!fairFormActive, 'fair-form not active');
		test.skip(fairAudienceActive, 'fair-audience active — see linked test');

		const email = uniqueEmail('anon');
		// Use its own event date so the submission lookup by email is unambiguous.
		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				event_id: eventPostId,
				start_datetime: '2035-06-02 10:00:00',
				end_datetime: '2035-06-02 12:00:00',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		const anonEventDateId = (await edRes.json()).id;

		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: anonEventDateId,
				name: 'Anon Tester',
				email,
				quantity: 1,
				questionnaire_answers: [nameQuestion(email)],
			},
		});
		expect(res.ok()).toBeTruthy();
		expect((await res.json()).status).toBe('confirmed');

		const responsesRes = await api.get(
			'/wp-json/fair-form/v1/questionnaire-responses',
			{
				headers: adminHeaders,
				params: {
					event_date_id: anonEventDateId,
					title: 'Event Signup',
				},
			}
		);
		expect(responsesRes.ok()).toBeTruthy();
		const submissions = await responsesRes.json();
		expect(submissions.length).toBe(1);
		expect(submissions[0].participant_id).toBe(0);
		expect(
			submissions[0].answers.some((a) => a.answer_value === email)
		).toBeTruthy();
	});

	test('answers are linked to the fair-audience participant when fair-audience is active', async () => {
		test.skip(!fairFormActive, 'fair-form not active');
		test.skip(!fairAudienceActive, 'fair-audience not active');

		const email = uniqueEmail('linked');
		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				name: 'Linked Tester',
				email,
				quantity: 1,
				questionnaire_answers: [nameQuestion(email)],
			},
		});
		expect(res.ok()).toBeTruthy();
		expect((await res.json()).status).toBe('confirmed');

		const participantsRes = await api.get(
			'/wp-json/fair-audience/v1/participants',
			{ headers: adminHeaders, params: { search: email } }
		);
		expect(participantsRes.ok()).toBeTruthy();
		const participant = (await participantsRes.json()).find(
			(p) => p.email === email
		);
		expect(participant).toBeTruthy();

		const submission = await findSubmission(email);
		expect(submission).toBeTruthy();
		expect(submission.participant_id).toBe(participant.id);
	});

	test('invalid answers are rejected with no signup created', async () => {
		test.skip(!fairFormActive, 'fair-form not active');

		const before = await countSignups(eventDateId);
		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				name: 'Invalid Tester',
				email: uniqueEmail('invalid'),
				quantity: 1,
				questionnaire_answers: [phoneQuestion('not-a-phone-number')],
			},
		});
		expect(res.status()).toBe(400);
		expect((await res.json()).code).toBe('invalid_phone');
		expect(await countSignups(eventDateId)).toBe(before);
	});

	test('answers are ignored gracefully when fair-form is inactive', async () => {
		test.skip(fairFormActive, 'fair-form active — see stored-answer tests');

		const email = uniqueEmail('noform');
		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				name: 'No Form Tester',
				email,
				quantity: 1,
				questionnaire_answers: [nameQuestion(email)],
			},
		});
		expect(res.ok()).toBeTruthy();
		expect((await res.json()).status).toBe('confirmed');
	});
});
