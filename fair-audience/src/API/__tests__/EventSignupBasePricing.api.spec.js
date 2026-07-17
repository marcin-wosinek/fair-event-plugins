/**
 * Playwright API tests for base signup pricing without the experimental
 * plugin (#1180): with only fair-events + fair-audience active, the signup
 * flow must resolve prices through FairEvents\Services\SignupPricing /
 * TicketPricing (via FairAudience\Services\SignupPriceResolver) instead of
 * silently collapsing to free.
 *
 * Like EventSignupSlidingScale's and GetTicketsPaymentUnavailable's specs,
 * this assumes the dev stack has no payment connector configured: any event
 * with a positive price must be rejected with 503 payment_unavailable,
 * never confirmed for free. A free (price-0) ticket type on the same event
 * must still confirm, proving the guard isn't over-blocking.
 *
 * These assertions hold in both plugin configurations (base-only and with
 * fair-events-experimental active) — the resolver falls back correctly
 * either way — so the spec runs unconditionally rather than skipping based
 * on experimental plugin state.
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

test.describe('Base signup pricing — simple per-date price', () => {
	let api;
	let event;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
		event = await createEventWithDates(
			api,
			`Base Pricing Simple Test ${Date.now()}`
		);

		const configRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${event.eventDateId}/tickets`,
			{
				headers: authHeaders,
				data: {
					signup_price: 12.5,
					settings: {},
				},
			}
		);
		expect(configRes.ok(), await configRes.text()).toBeTruthy();
	});

	test.afterAll(async () => {
		await deleteEvent(api, event?.eventId);
		await api.dispose();
	});

	test('a priced simple signup is rejected 503 and writes nothing (never falls through free)', async () => {
		const res = await api.post('/wp-json/fair-audience/v1/event-signup', {
			headers: authHeaders,
			data: {
				event_id: event.eventId,
				event_date_id: event.eventDateId,
			},
		});
		expect(res.status()).toBe(503);
		expect((await res.json()).code).toBe('payment_unavailable');

		const statusRes = await api.get(
			'/wp-json/fair-audience/v1/event-signup/status',
			{
				headers: authHeaders,
				params: {
					event_id: event.eventId,
					event_date_id: event.eventDateId,
				},
			}
		);
		expect(statusRes.ok()).toBeTruthy();
		expect((await statusRes.json()).is_signed_up).toBe(false);
	});
});

test.describe('Base signup pricing — ticket-type price', () => {
	let api;
	let event;
	let paidTypeId;
	let freeTypeId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
		event = await createEventWithDates(
			api,
			`Base Pricing Ticket Type Test ${Date.now()}`
		);

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${event.eventDateId}/tickets`,
			{
				headers: authHeaders,
				data: {
					ticket_types: [
						{
							name: 'Paid tier',
							capacity: null,
							sort_order: 0,
							recurrence_scope: 'single_instance',
						},
						{
							name: 'Free tier',
							capacity: null,
							sort_order: 1,
							recurrence_scope: 'single_instance',
						},
					],
					sale_periods: [
						{
							name: 'Always on',
							sale_start: '2020-01-01 00:00:00',
							sale_end: '2099-01-01 00:00:00',
						},
					],
					prices: [
						{
							ticket_type_index: 0,
							sale_period_index: 0,
							price: 18,
						},
					],
					settings: {},
				},
			}
		);
		expect(ticketsRes.ok(), await ticketsRes.text()).toBeTruthy();
		const types = (await ticketsRes.json()).ticket_types || [];
		paidTypeId = types.find((t) => t.name === 'Paid tier')?.id;
		freeTypeId = types.find((t) => t.name === 'Free tier')?.id;
		expect(paidTypeId).toBeTruthy();
		expect(freeTypeId).toBeTruthy();
	});

	test.afterAll(async () => {
		await deleteEvent(api, event?.eventId);
		await api.dispose();
	});

	test('a priced ticket-type signup is rejected 503 and writes nothing', async () => {
		const res = await api.post('/wp-json/fair-audience/v1/event-signup', {
			headers: authHeaders,
			data: {
				event_id: event.eventId,
				event_date_id: event.eventDateId,
				ticket_type_id: paidTypeId,
				email: uniqueEmail('base-pricing-paid'),
			},
		});
		expect(res.status()).toBe(503);
		expect((await res.json()).code).toBe('payment_unavailable');
	});

	test('a ticket type with no price row (0) still confirms', async () => {
		const res = await api.post('/wp-json/fair-audience/v1/event-signup', {
			headers: authHeaders,
			data: {
				event_id: event.eventId,
				event_date_id: event.eventDateId,
				ticket_type_id: freeTypeId,
			},
		});
		expect(res.ok(), await res.text()).toBeTruthy();
		expect((await res.json()).status).toMatch(
			/^(signed_up|already_signed_up)$/
		);
	});
});
