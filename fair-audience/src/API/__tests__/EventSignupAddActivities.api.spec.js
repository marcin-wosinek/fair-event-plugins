/**
 * Playwright API tests for the add-activities endpoint on EventSignupController
 * (issue #611): POST /fair-audience/v1/event-signup/add-activities.
 *
 * The endpoint resolves the acting participant from the logged-in user, so the
 * suite links a participant to the admin WP user (Application Password creds)
 * and tears it down afterwards. A free (price 0) activity is used so the happy
 * path attaches immediately without routing through Mollie — the paid delta
 * flow is covered by manual verification.
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

async function createEvent(api, title) {
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
	expect(match, 'event-date row for the test event').toBeTruthy();
	return { eventId, eventDateId: match.event_date_id };
}

test.describe('EventSignupController add-activities', () => {
	let api;
	let adminUserId;
	let participantId;
	let signedUpEvent;
	let otherEvent;
	let freeOptionId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const meRes = await api.get('/wp-json/wp/v2/users/me', {
			headers: authHeaders,
		});
		expect(meRes.ok()).toBeTruthy();
		adminUserId = (await meRes.json()).id;

		// Participant linked to the admin user so the add-activities endpoint
		// resolves to it from the logged-in session.
		const partRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Add Activities Tester',
					email: uniqueEmail('add-activities'),
					wp_user_id: adminUserId,
				},
			}
		);
		expect(
			partRes.ok(),
			'admin must not be pre-linked to a participant'
		).toBeTruthy();
		participantId = (await partRes.json()).id;

		signedUpEvent = await createEvent(
			api,
			`Add Activities Signed ${Date.now()}`
		);
		otherEvent = await createEvent(
			api,
			`Add Activities Other ${Date.now()}`
		);

		// Sign the participant up for the first event.
		const linkRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${signedUpEvent.eventDateId}/participants/batch`,
			{
				headers: authHeaders,
				data: { participant_ids: [participantId], label: 'signed_up' },
			}
		);
		expect(linkRes.ok()).toBeTruthy();

		// Add a free activity option on the signed-up event date.
		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${signedUpEvent.eventDateId}/tickets`,
			{
				headers: authHeaders,
				data: { options: [{ name: 'Free Workshop', price: 0 }] },
			}
		);
		expect(ticketsRes.ok()).toBeTruthy();
		const config = await ticketsRes.json();
		const option = (config.options || []).find(
			(o) => o.name === 'Free Workshop'
		);
		expect(option, 'created free option').toBeTruthy();
		freeOptionId = option.id;
	});

	test.afterAll(async () => {
		if (participantId) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${participantId}`,
				{ headers: authHeaders }
			);
		}
		for (const ev of [signedUpEvent, otherEvent]) {
			if (ev?.eventId) {
				await api.delete(`/wp-json/wp/v2/fair_event/${ev.eventId}`, {
					headers: authHeaders,
					params: { force: 'true' },
				});
			}
		}
		await api.dispose();
	});

	test('unauthenticated request is rejected', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/event-signup/add-activities',
			{
				data: {
					event_id: signedUpEvent.eventId,
					ticket_option_ids: [freeOptionId],
				},
			}
		);
		expect(res.status()).toBe(401);
	});

	test('unknown event returns 404', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/event-signup/add-activities',
			{
				headers: authHeaders,
				data: { event_id: 99999999, ticket_option_ids: [freeOptionId] },
			}
		);
		expect(res.status()).toBe(404);
	});

	test('adding to an event the participant is not signed up for is rejected', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/event-signup/add-activities',
			{
				headers: authHeaders,
				data: {
					event_id: otherEvent.eventId,
					ticket_option_ids: [freeOptionId],
				},
			}
		);
		expect(res.status()).toBe(400);
		expect((await res.json()).code).toBe('not_signed_up');
	});

	test('free activity is added immediately and reflected on the subscription', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/event-signup/add-activities',
			{
				headers: authHeaders,
				data: {
					event_id: signedUpEvent.eventId,
					ticket_option_ids: [freeOptionId],
				},
			}
		);
		expect(res.ok()).toBeTruthy();
		expect((await res.json()).status).toBe('activities_added');

		const listRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${signedUpEvent.eventDateId}/participants`,
			{ headers: authHeaders }
		);
		expect(listRes.ok()).toBeTruthy();
		const row = (await listRes.json()).find(
			(p) => p.participant_id === participantId
		);
		expect(row).toBeTruthy();
		expect(row.ticket_option_ids).toContain(freeOptionId);
	});

	test('re-adding the same activity is rejected by the duplicate guard', async () => {
		const res = await api.post(
			'/wp-json/fair-audience/v1/event-signup/add-activities',
			{
				headers: authHeaders,
				data: {
					event_id: signedUpEvent.eventId,
					ticket_option_ids: [freeOptionId],
				},
			}
		);
		expect(res.status()).toBe(400);
		expect((await res.json()).code).toBe('no_new_activities');
	});
});
