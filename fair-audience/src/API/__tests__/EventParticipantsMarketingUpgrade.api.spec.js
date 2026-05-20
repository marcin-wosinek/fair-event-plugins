/**
 * Playwright API tests for the marketing-upgrade endpoint on
 * EventParticipantsController.
 *
 * Exercises POST
 * /fair-audience/v1/event-dates/{event_date_id}/participants/marketing-upgrade
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

test.describe('EventParticipantsController marketing-upgrade', () => {
	let api;
	let eventId;
	let eventDateId;
	let minimalId;
	let marketingId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		// Publish an event; fair-events lifecycle hooks create its event-date row.
		const eventRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: authHeaders,
			data: {
				title: `Marketing Upgrade Test ${Date.now()}`,
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

		// One eligible participant (minimal + email), one already on the list.
		minimalId = await createParticipant(api, {
			name: 'Minimal Person',
			email: uniqueEmail('minimal'),
			email_profile: 'minimal',
		});
		marketingId = await createParticipant(api, {
			name: 'Marketing Person',
			email: uniqueEmail('marketing'),
			email_profile: 'marketing',
		});

		// Link both to this event date.
		const linkRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/batch`,
			{
				headers: authHeaders,
				data: {
					participant_ids: [minimalId, marketingId],
					label: 'signed_up',
				},
			}
		);
		expect(linkRes.ok()).toBeTruthy();
	});

	test.afterAll(async () => {
		for (const id of [minimalId, marketingId]) {
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

	test('participant list exposes email_profile', async () => {
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants`,
			{ headers: authHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const list = await res.json();

		const minimal = list.find((p) => p.participant_id === minimalId);
		const marketing = list.find((p) => p.participant_id === marketingId);
		expect(minimal.email_profile).toBe('minimal');
		expect(marketing.email_profile).toBe('marketing');
	});

	test('already-marketing participant is skipped, not upgraded', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-upgrade`,
			{ headers: authHeaders, data: { participant_ids: [marketingId] } }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(body.upgraded).toBe(0);
		expect(body.skipped).toBeGreaterThanOrEqual(1);
	});

	test('upgrade flips minimal → marketing and is idempotent (no re-email)', async () => {
		// First upgrade: the minimal participant is flipped and emailed once.
		const first = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-upgrade`,
			{ headers: authHeaders, data: { participant_ids: [minimalId] } }
		);
		expect(first.ok()).toBeTruthy();
		const firstBody = await first.json();
		expect(firstBody.upgraded).toBe(1);

		// The profile is now marketing.
		const listRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants`,
			{ headers: authHeaders }
		);
		const list = await listRes.json();
		const upgraded = list.find((p) => p.participant_id === minimalId);
		expect(upgraded.email_profile).toBe('marketing');

		// Re-running upgrades nobody and skips the now-marketing participant,
		// proving the welcome email is not sent a second time.
		const second = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-upgrade`,
			{ headers: authHeaders, data: { participant_ids: [minimalId] } }
		);
		expect(second.ok()).toBeTruthy();
		const secondBody = await second.json();
		expect(secondBody.upgraded).toBe(0);
		expect(secondBody.skipped).toBeGreaterThanOrEqual(1);
	});

	test('unauthenticated upgrade is rejected', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-upgrade`,
			{ data: { participant_ids: [minimalId] } }
		);
		expect(res.status()).toBeGreaterThanOrEqual(401);
		expect(res.status()).toBeLessThan(404);
	});
});
