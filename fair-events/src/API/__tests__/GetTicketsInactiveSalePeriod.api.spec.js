/**
 * Playwright API tests for #1393: a ticket type with no price row for the
 * currently active sale period must not be purchasable — not even via a
 * direct API call that bypasses the (already-filtered) signup form.
 *
 * Covers the backend fail-closed half of the fix: create_signup() must
 * reject an out-of-window ticket_type_id with 409 ticket_type_unavailable
 * instead of silently charging 0 when resolve_unit_price() returns null.
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

/**
 * Creates an event date with two ticket types and two non-overlapping sale
 * periods: a closed (past) period priced only for "Early bird", and the
 * currently active period priced only for "Regular". "Early bird" therefore
 * has no price row for the active period — the exact "caught between
 * windows" scenario from the ticket.
 */
async function createEventWithInactiveType(api) {
	const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
		headers: adminHeaders,
		data: {
			title: `Inactive sale-period test ${Date.now()}-${Math.random()}`,
			start_datetime: '2035-06-01 10:00:00',
			end_datetime: '2035-06-01 12:00:00',
		},
	});
	expect(edRes.ok()).toBeTruthy();
	const eventDateId = (await edRes.json()).id;

	const ticketsRes = await api.put(
		`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
		{
			headers: adminHeaders,
			data: {
				ticket_types: [
					{
						name: 'Early bird',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
					{
						name: 'Regular',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
				],
				sale_periods: [
					{
						name: 'Early bird window (closed)',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2020-02-01 00:00:00',
					},
					{
						name: 'Regular window (active)',
						sale_start: '2020-02-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [
					{
						ticket_type_index: 0,
						sale_period_index: 0,
						price: 5,
					},
					// Free, so acceptance doesn't depend on a configured payment
					// connector — this test isolates the sale-period filtering,
					// not payment availability (covered elsewhere).
					{
						ticket_type_index: 1,
						sale_period_index: 1,
						price: 0,
					},
				],
				settings: {},
			},
		}
	);
	expect(ticketsRes.ok()).toBeTruthy();
	const body = await ticketsRes.json();
	const earlyBirdTypeId = body.ticket_types?.[0]?.id;
	const regularTypeId = body.ticket_types?.[1]?.id;
	expect(earlyBirdTypeId).toBeTruthy();
	expect(regularTypeId).toBeTruthy();

	return { eventDateId, earlyBirdTypeId, regularTypeId };
}

function purchase(api, eventDateId, ticketTypeId) {
	return api.post('/wp-json/fair-events/v1/get-tickets', {
		data: {
			event_date_id: eventDateId,
			name: 'Inactive Window Tester',
			email: `inactive-window-${Date.now()}-${Math.random()}@example.test`,
			ticket_type_id: ticketTypeId,
			quantity: 1,
		},
	});
}

test.describe('GetTicketsController — inactive sale-period ticket types (#1393)', () => {
	let api;
	const createdEventDateIds = [];

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		for (const id of createdEventDateIds) {
			await api.delete(`/wp-json/fair-events/v1/event-dates/${id}`, {
				headers: adminHeaders,
			});
		}
		await api.dispose();
	});

	test('a ticket type with no price in the active sale period is rejected with 409 ticket_type_unavailable', async () => {
		const { eventDateId, earlyBirdTypeId } =
			await createEventWithInactiveType(api);
		createdEventDateIds.push(eventDateId);

		const res = await purchase(api, eventDateId, earlyBirdTypeId);
		expect(res.status()).toBe(409);
		expect((await res.json()).code).toBe('ticket_type_unavailable');
	});

	test('a ticket type priced for the active sale period is accepted', async () => {
		const { eventDateId, regularTypeId } =
			await createEventWithInactiveType(api);
		createdEventDateIds.push(eventDateId);

		const res = await purchase(api, eventDateId, regularTypeId);
		expect(res.ok()).toBeTruthy();
	});
});
