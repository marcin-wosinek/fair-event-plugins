/**
 * Playwright API tests for SignupHookBridge (#1083, PR 2): a signup created
 * through fair-events' unified route (fair-events/v1/get-tickets) must, when
 * fair-audience is active, also create/link a fair-audience Participant and
 * EventParticipant record via the fair_events_signup_created action.
 *
 * Skips gracefully when fair-audience is not active in the test environment.
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

test.describe('SignupHookBridge — base get-tickets route links a Participant', () => {
	let api;
	let fairAudienceActive = false;
	let eventPostId;
	let eventDateId;
	const buyerEmail = `signup-hook-bridge-${Date.now()}@example.test`;
	const buyerName = 'Signup Hook Bridge Tester';

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
		if (!fairAudienceActive) {
			return;
		}

		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Signup hook bridge test ${Date.now()}`,
				status: 'publish',
			},
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				event_id: eventPostId,
				start_datetime: '2035-07-01 10:00:00',
				end_datetime: '2035-07-01 12:00:00',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		eventDateId = (await edRes.json()).id;
	});

	test.afterAll(async () => {
		if (fairAudienceActive && eventPostId) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${eventPostId}?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	});

	test('a free signup through the base route creates a linked Participant and EventParticipant', async () => {
		test.skip(!fairAudienceActive, 'fair-audience not active');

		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				name: buyerName,
				email: buyerEmail,
				quantity: 1,
			},
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.status).toBe('confirmed');

		// The fair_events_signups row exists (base plugin's own record).
		const signupsRes = await api.get(
			'/wp-json/fair-events/v1/get-tickets',
			{
				headers: adminHeaders,
				params: { event_date: eventDateId },
			}
		);
		expect(signupsRes.ok()).toBeTruthy();
		const signups = await signupsRes.json();
		expect(signups.some((s) => s.email === buyerEmail)).toBeTruthy();

		// SignupHookBridge linked a fair-audience Participant by email.
		const participantsRes = await api.get(
			'/wp-json/fair-audience/v1/participants',
			{ headers: adminHeaders, params: { search: buyerEmail } }
		);
		expect(participantsRes.ok()).toBeTruthy();
		const participantsBody = await participantsRes.json();
		const participant = participantsBody.find(
			(p) => p.email === buyerEmail
		);
		expect(participant).toBeTruthy();

		// ...and an EventParticipant row ties that participant to this event date.
		const eventParticipantsRes = await api.get(
			'/wp-json/fair-audience/v1/event-participants',
			{ headers: adminHeaders, params: { event_date_id: eventDateId } }
		);
		expect(eventParticipantsRes.ok()).toBeTruthy();
		const eventParticipants = await eventParticipantsRes.json();
		const items = Array.isArray(eventParticipants)
			? eventParticipants
			: eventParticipants.items || [];
		expect(
			items.some((ep) => ep.participant_id === participant.id)
		).toBeTruthy();
	});
});
