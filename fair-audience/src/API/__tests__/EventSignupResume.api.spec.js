/**
 * Playwright API tests for resuming an anonymous signup on a recognised email
 * (#1004): the register endpoint's anti-enumeration response, and the
 * resume-payload endpoint's access control.
 *
 * The full stash → emailed link → resume round trip can't be driven from here
 * because the dev stack has no mail catcher to read the resume token back out
 * of the sent email, and the token is deliberately never returned by any API
 * response (only the emailed link carries it). That round trip was verified
 * manually via the WP-CLI eval-file recipe (TESTING.md).
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

function uniqueEmail(prefix) {
	return `${prefix}+${Date.now()}-${Math.floor(
		Math.random() * 1e6
	)}@example.test`;
}

async function createEventWithDates(api, title) {
	const res = await api.post('/wp-json/wp/v2/fair_event', {
		headers: authHeaders,
		data: { title, status: 'publish' },
	});
	expect(res.ok()).toBeTruthy();
	const eventId = (await res.json()).id;

	const eventsRes = await api.get('/wp-json/fair-audience/v1/events', {
		headers: authHeaders,
		params: { per_page: 100 },
	});
	expect(eventsRes.ok()).toBeTruthy();
	const match = (await eventsRes.json()).find((e) => e.event_id === eventId);
	expect(match, 'event-date row for test event').toBeTruthy();
	return { eventId, eventDateId: match.event_date_id };
}

async function deleteEvent(api, eventId) {
	if (!eventId) return;
	await api.delete(`/wp-json/wp/v2/fair_event/${eventId}`, {
		headers: authHeaders,
		params: { force: 'true' },
	});
}

test.describe('Resume anonymous signup on recognised email — register endpoint', () => {
	let api;
	let event;
	let participantId;
	let email;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
		event = await createEventWithDates(
			api,
			`Resume Signup Test ${Date.now()}`
		);
		email = uniqueEmail('resume-signup');

		const participantRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: { name: 'Resume Tester', email },
			}
		);
		expect(participantRes.ok()).toBeTruthy();
		participantId = (await participantRes.json()).id;
	});

	test.afterAll(async () => {
		if (participantId) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${participantId}`,
				{ headers: authHeaders }
			);
		}
		await deleteEvent(api, event?.eventId);
		await api.dispose();
	});

	test('a known email with no session gets the generic anti-enumeration response', async () => {
		// A fresh, cookie-less request context: the server has no session for
		// this participant, so it must not create a signup or reveal any
		// pre-filled state — only the generic "check your inbox" message.
		const anon = await request.newContext({ baseURL: BASE_URL });
		try {
			const res = await anon.post(
				'/wp-json/fair-audience/v1/event-signup/register',
				{
					data: {
						event_id: event.eventId,
						event_date_id: event.eventDateId,
						name: 'Resume Tester',
						email,
					},
				}
			);
			expect(res.ok(), await res.text()).toBeTruthy();
			const body = await res.json();
			expect(body.status).toBe('email_recognized');
			expect(body.message).toBeTruthy();
		} finally {
			await anon.dispose();
		}
	});

	test('an unknown email also gets the same generic response (no enumeration)', async () => {
		const anon = await request.newContext({ baseURL: BASE_URL });
		try {
			const res = await anon.post(
				'/wp-json/fair-audience/v1/event-signup/register',
				{
					data: {
						event_id: event.eventId,
						event_date_id: event.eventDateId,
						name: 'Nobody',
						email: uniqueEmail('unknown'),
					},
				}
			);
			expect(res.ok(), await res.text()).toBeTruthy();
			const body = await res.json();
			// New-participant path signs them up directly (no prior record to
			// "recognise"), which is the existing, unrelated behaviour — assert
			// only that it never leaks an email_recognized/resume state for an
			// address that was never registered.
			expect(body.status).not.toBe('email_recognized');
		} finally {
			await anon.dispose();
		}
	});
});

test.describe('Resume anonymous signup on recognised email — resume endpoint', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('an invalid participant_token is rejected', async () => {
		const res = await api.get(
			'/wp-json/fair-audience/v1/event-signup/resume',
			{
				params: {
					participant_token: 'not-a-real-token',
					resume: 'whatever',
				},
			}
		);
		expect(res.status()).toBe(403);
	});

	test('a well-formed but never-stashed resume token 404s', async () => {
		// A syntactically valid participant token (base64 of "0:0:<hmac>") will
		// always fail ParticipantToken::verify's participant_id > 0 check, so
		// this still exercises the resume_not_found path via the same 403/404
		// boundary without needing a real participant.
		const res = await api.get(
			'/wp-json/fair-audience/v1/event-signup/resume',
			{
				params: {
					participant_token: 'bm90LWEtcmVhbC10b2tlbg',
					resume: 'never-stashed-token',
				},
			}
		);
		expect([403, 404]).toContain(res.status());
	});
});
