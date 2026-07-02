/**
 * Playwright API tests for sliding-scale (pay-what-you-can) pricing (#932):
 * TicketsController config validation (min <= suggested <= max, decimal
 * round-trip) and the event-signup chosen_amount contract.
 *
 * The dev stack has no payment connector configured, so any event date with
 * a positive suggested price returns 503 payment_unavailable on signup — a
 * paid event must never slip through as free. To exercise the signup path
 * itself we use an all-zero band (min = max = suggested = 0), which is the
 * one sliding-scale configuration that resolves to the free path regardless
 * of environment.
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

test.describe('Sliding-scale pricing — TicketsController config validation', () => {
	let api;
	let event;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
		event = await createEventWithDates(
			api,
			`Sliding Scale Config Test ${Date.now()}`
		);
	});

	test.afterAll(async () => {
		await deleteEvent(api, event?.eventId);
		await api.dispose();
	});

	test('min <= suggested <= max is saved and round-trips as decimals', async () => {
		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${event.eventDateId}/tickets`,
			{
				headers: authHeaders,
				data: {
					signup_price: 20,
					settings: {
						sliding_scale_enabled: true,
						sliding_scale_min: 5.5,
						sliding_scale_max: 50.25,
					},
				},
			}
		);
		expect(res.ok(), await res.text()).toBeTruthy();
		const body = await res.json();
		expect(body.signup_price).toBe(20);
		expect(body.settings.sliding_scale_enabled).toBe(true);
		expect(body.settings.sliding_scale_min).toBe(5.5);
		expect(body.settings.sliding_scale_max).toBe(50.25);
	});

	test('min > suggested is rejected with 400', async () => {
		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${event.eventDateId}/tickets`,
			{
				headers: authHeaders,
				data: {
					signup_price: 20,
					settings: {
						sliding_scale_enabled: true,
						sliding_scale_min: 25,
						sliding_scale_max: 50,
					},
				},
			}
		);
		expect(res.status()).toBe(400);
	});

	test('suggested > max is rejected with 400', async () => {
		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${event.eventDateId}/tickets`,
			{
				headers: authHeaders,
				data: {
					signup_price: 100,
					settings: {
						sliding_scale_enabled: true,
						sliding_scale_min: 5,
						sliding_scale_max: 50,
					},
				},
			}
		);
		expect(res.status()).toBe(400);
	});

	test('an invalid band is not persisted after a rejected save', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${event.eventDateId}/tickets`,
			{ headers: authHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		// Still the last successfully-saved band from the first test.
		expect(body.settings.sliding_scale_min).toBe(5.5);
		expect(body.settings.sliding_scale_max).toBe(50.25);
	});
});

test.describe('Sliding-scale pricing — signup with an all-zero band', () => {
	let api;
	let adminUserId;
	let event;
	let participantId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const meRes = await api.get('/wp-json/wp/v2/users/me', {
			headers: authHeaders,
		});
		expect(meRes.ok()).toBeTruthy();
		adminUserId = (await meRes.json()).id;

		event = await createEventWithDates(
			api,
			`Sliding Scale Free Test ${Date.now()}`
		);

		const configRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${event.eventDateId}/tickets`,
			{
				headers: authHeaders,
				data: {
					signup_price: 0,
					settings: {
						sliding_scale_enabled: true,
						sliding_scale_min: 0,
						sliding_scale_max: 0,
					},
				},
			}
		);
		expect(configRes.ok(), await configRes.text()).toBeTruthy();

		const participantRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Sliding Scale Tester',
					email: uniqueEmail('sliding-scale'),
					wp_user_id: adminUserId,
				},
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

	test('a chosen_amount outside [0, 0] still clamps to the free path', async () => {
		const res = await api.post('/wp-json/fair-audience/v1/event-signup', {
			headers: authHeaders,
			data: {
				event_id: event.eventId,
				event_date_id: event.eventDateId,
				chosen_amount: 999,
			},
		});
		expect(res.ok(), await res.text()).toBeTruthy();
		const body = await res.json();
		expect(body.status).toMatch(/^(signed_up|already_signed_up)$/);
	});
});
