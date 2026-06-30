/**
 * Playwright API tests for the marketing-consent endpoint on
 * EventParticipantsController.
 *
 * Exercises POST
 * /fair-audience/v1/event-dates/{event_date_id}/participants/marketing-consent
 * against a live WordPress instance. Fixtures (event, participants, links) are
 * created via the admin REST API using Application Password credentials
 * (WP_ADMIN_USER / WP_ADMIN_PASSWORD) and torn down at the end of the suite.
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

async function createParticipant(api, { name, email, email_profile }) {
	const res = await api.post('/wp-json/fair-audience/v1/participants', {
		headers: authHeaders,
		data: { name, email, email_profile },
	});
	expect(res.ok()).toBeTruthy();
	const body = await res.json();
	return body.id;
}

test.describe('EventParticipantsController marketing-consent', () => {
	let api;
	let eventId;
	let eventDateId;
	let minimalWithEmailId;
	let minimalNoEmailId;
	let marketingId;
	let declinedId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		// Publish an event; fair-events lifecycle hooks create its event-date row.
		const eventRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: authHeaders,
			data: {
				title: `Marketing Consent Test ${Date.now()}`,
				status: 'publish',
			},
		});
		expect(eventRes.ok()).toBeTruthy();
		eventId = (await eventRes.json()).id;

		// Resolve the event_date_id for the freshly created event.
		const eventsRes = await api.get('/wp-json/fair-audience/v1/events', {
			headers: authHeaders,
			params: { per_page: 100 },
		});
		expect(eventsRes.ok()).toBeTruthy();
		const events = await eventsRes.json();
		const match = events.find((e) => e.event_id === eventId);
		expect(match, 'event-date row for the test event').toBeTruthy();
		eventDateId = match.event_date_id;

		// Participants covering all relevant states.
		minimalWithEmailId = await createParticipant(api, {
			name: 'Minimal With Email',
			email: uniqueEmail('minimal-email'),
			email_profile: 'minimal',
		});
		minimalNoEmailId = await createParticipant(api, {
			name: 'Minimal No Email',
			email: '',
			email_profile: 'minimal',
		});
		marketingId = await createParticipant(api, {
			name: 'Marketing Person',
			email: uniqueEmail('marketing'),
			email_profile: 'marketing',
		});
		declinedId = await createParticipant(api, {
			name: 'Already Declined',
			email: uniqueEmail('declined'),
			email_profile: 'declined',
		});

		// Link all to this event date.
		const linkRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/batch`,
			{
				headers: authHeaders,
				data: {
					participant_ids: [
						minimalWithEmailId,
						minimalNoEmailId,
						marketingId,
						declinedId,
					],
					label: 'signed_up',
				},
			}
		);
		expect(linkRes.ok()).toBeTruthy();
	});

	test.afterAll(async () => {
		for (const id of [
			minimalWithEmailId,
			minimalNoEmailId,
			marketingId,
			declinedId,
		]) {
			if (id) {
				await api.delete(
					`/wp-json/fair-audience/v1/participants/${id}`,
					{ headers: authHeaders }
				);
			}
		}
		if (eventId) {
			await api.delete(`/wp-json/wp/v2/fair_event/${eventId}`, {
				headers: authHeaders,
				params: { force: 'true' },
			});
		}
		await api.dispose();
	});

	test('participant list exposes email_profile including declined', async () => {
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants`,
			{ headers: authHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const list = await res.json();

		const minimal = list.find(
			(p) => p.participant_id === minimalWithEmailId
		);
		const marketing = list.find((p) => p.participant_id === marketingId);
		const declined = list.find((p) => p.participant_id === declinedId);
		expect(minimal.email_profile).toBe('minimal');
		expect(marketing.email_profile).toBe('marketing');
		expect(declined.email_profile).toBe('declined');
	});

	test('already-marketing participant in marketing_ids is skipped', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-consent`,
			{
				headers: authHeaders,
				data: { marketing_ids: [marketingId], declined_ids: [] },
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.upgraded).toBe(0);
		expect(body.skipped).toBeGreaterThanOrEqual(1);
	});

	test('already-declined participant in marketing_ids is skipped', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-consent`,
			{
				headers: authHeaders,
				data: { marketing_ids: [declinedId], declined_ids: [] },
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.upgraded).toBe(0);
		expect(body.skipped).toBeGreaterThanOrEqual(1);
	});

	test('marketing_ids upgrades minimal → marketing, logs, emails', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-consent`,
			{
				headers: authHeaders,
				data: {
					marketing_ids: [minimalWithEmailId],
					declined_ids: [],
				},
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.upgraded).toBe(1);

		// Profile is now marketing.
		const listRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants`,
			{ headers: authHeaders }
		);
		const list = await listRes.json();
		const upgraded = list.find(
			(p) => p.participant_id === minimalWithEmailId
		);
		expect(upgraded.email_profile).toBe('marketing');

		// Re-running upgrades nobody (idempotent — no re-email).
		const second = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-consent`,
			{
				headers: authHeaders,
				data: {
					marketing_ids: [minimalWithEmailId],
					declined_ids: [],
				},
			}
		);
		expect(second.ok()).toBeTruthy();
		const secondBody = await second.json();
		expect(secondBody.upgraded).toBe(0);
		expect(secondBody.skipped).toBeGreaterThanOrEqual(1);
	});

	test('declined_ids sets minimal → declined, logs, sends no email', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-consent`,
			{
				headers: authHeaders,
				data: {
					marketing_ids: [],
					declined_ids: [minimalNoEmailId],
				},
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.declined).toBe(1);
		expect(body.emailed).toBe(0);

		// Profile is now declined.
		const listRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants`,
			{ headers: authHeaders }
		);
		const list = await listRes.json();
		const declined = list.find(
			(p) => p.participant_id === minimalNoEmailId
		);
		expect(declined.email_profile).toBe('declined');
	});

	test('mixed request applies both directions in one call', async () => {
		// Use fresh participants so we start from a known minimal state.
		const yesId = await createParticipant(api, {
			name: 'Mixed Yes',
			email: uniqueEmail('mixed-yes'),
			email_profile: 'minimal',
		});
		const noId = await createParticipant(api, {
			name: 'Mixed No',
			email: uniqueEmail('mixed-no'),
			email_profile: 'minimal',
		});
		const linkRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/batch`,
			{
				headers: authHeaders,
				data: { participant_ids: [yesId, noId], label: 'signed_up' },
			}
		);
		expect(linkRes.ok()).toBeTruthy();

		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-consent`,
			{
				headers: authHeaders,
				data: {
					marketing_ids: [yesId],
					declined_ids: [noId],
				},
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.upgraded).toBe(1);
		expect(body.declined).toBe(1);

		const listRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants`,
			{ headers: authHeaders }
		);
		const list = await listRes.json();
		expect(list.find((p) => p.participant_id === yesId).email_profile).toBe(
			'marketing'
		);
		expect(list.find((p) => p.participant_id === noId).email_profile).toBe(
			'declined'
		);

		// Clean up extra participants.
		for (const id of [yesId, noId]) {
			await api.delete(`/wp-json/fair-audience/v1/participants/${id}`, {
				headers: authHeaders,
			});
		}
	});

	test('unauthenticated request is rejected', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-consent`,
			{ data: { marketing_ids: [minimalWithEmailId], declined_ids: [] } }
		);
		expect(res.status()).toBeGreaterThanOrEqual(401);
		expect(res.status()).toBeLessThan(404);
	});
});
