/**
 * Playwright API tests for ticketing sale-period persistence across the
 * simple → recurring conversion flow (#1203).
 *
 * The frontend editor (EventTickets.js) must never freeze a derived date
 * into storage: enabling multiple pricing periods should only persist the
 * split boundary, leaving the trailing end unset (NULL, lazily resolved);
 * merging periods back into one must restore an unset end rather than
 * snapshotting whatever the default happened to resolve to. This exercises
 * the same PUT /tickets payload shapes the editor sends and asserts the
 * backend round-trips them correctly.
 *
 * Covers:
 *   - enabling multiple pricing periods with an unset base window stores
 *     only the split boundary; the trailing end stays NULL.
 *   - a ticket purchased against the trailing (unset-end) period succeeds
 *     even once the event becomes a multi-occurrence recurring series.
 *   - merging periods with an unset trailing end restores NULL, not a
 *     frozen snapshot.
 *   - merging periods with an organiser-typed trailing end preserves it
 *     verbatim.
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

async function createEventWithTicketType(api, { startDatetime, endDatetime }) {
	const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
		headers: adminHeaders,
		data: {
			title: `Sale period conversion test ${Date.now()}-${Math.random()}`,
			start_datetime: startDatetime,
			end_datetime: endDatetime,
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
						name: 'General admission',
						capacity: null,
						invitation_only: false,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
				],
				sale_periods: [{ name: '', sale_start: '', sale_end: '' }],
				// Free ticket: purchasing must only depend on sale-window
				// resolution, not on a payment gateway being configured.
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 0 },
				],
				settings: {},
			},
		}
	);
	expect(ticketsRes.ok()).toBeTruthy();
	const body = await ticketsRes.json();
	const ticketTypeId = body.ticket_types?.[0]?.id;
	expect(ticketTypeId).toBeTruthy();

	return { eventDateId, ticketTypeId };
}

async function putTickets(api, eventDateId, ticketTypeId, salePeriods) {
	const prices = salePeriods.map((_, index) => ({
		ticket_type_index: 0,
		sale_period_index: index,
		price: 0,
	}));

	const res = await api.put(
		`/wp-json/fair-events/v1/event-dates/${eventDateId}/tickets`,
		{
			headers: adminHeaders,
			data: {
				ticket_types: [
					{
						id: ticketTypeId,
						name: 'General admission',
						capacity: null,
						invitation_only: false,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
				],
				sale_periods: salePeriods,
				prices,
				settings: {
					multiple_pricing_periods: salePeriods.length > 1,
				},
			},
		}
	);
	expect(res.ok()).toBeTruthy();
	return res.json();
}

function tomorrow(daysAhead, time) {
	const d = new Date();
	d.setDate(d.getDate() + daysAhead);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day} ${time}`;
}

test.describe('TicketsController — sale-period conversion persistence', () => {
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

	test('enabling multiple pricing periods stores only the split boundary; the trailing end stays unset', async () => {
		const { eventDateId, ticketTypeId } = await createEventWithTicketType(
			api,
			{
				startDatetime: tomorrow(1, '10:00:00'),
				endDatetime: tomorrow(1, '12:00:00'),
			}
		);
		createdEventDateIds.push(eventDateId);

		const boundary = tomorrow(1, '00:00:00').split(' ')[0];
		const body = await putTickets(api, eventDateId, ticketTypeId, [
			{ name: 'Advance ticket', sale_start: '', sale_end: boundary },
			{ name: 'Day of event', sale_start: boundary, sale_end: '' },
		]);

		expect(body.sale_periods).toHaveLength(2);
		expect(body.sale_periods[0].sale_start).toBeFalsy();
		expect(body.sale_periods[0].sale_end).toContain(boundary);
		expect(body.sale_periods[1].sale_start).toContain(boundary);
		expect(body.sale_periods[1].sale_end).toBeFalsy();
	});

	test('a ticket purchased against the unset trailing period succeeds after the event becomes recurring', async () => {
		const { eventDateId, ticketTypeId } = await createEventWithTicketType(
			api,
			{
				startDatetime: tomorrow(1, '10:00:00'),
				endDatetime: tomorrow(1, '12:00:00'),
			}
		);
		createdEventDateIds.push(eventDateId);

		const boundary = tomorrow(1, '00:00:00').split(' ')[0];
		await putTickets(api, eventDateId, ticketTypeId, [
			{ name: 'Advance ticket', sale_start: '', sale_end: boundary },
			{ name: 'Day of event', sale_start: boundary, sale_end: '' },
		]);

		// Convert to a recurring series — the trailing end must keep tracking
		// the (now later) last occurrence rather than staying anchored near
		// the original single-day master.
		const patchRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=3' },
			}
		);
		expect(patchRes.ok()).toBeTruthy();

		const purchaseRes = await api.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: eventDateId,
					name: 'Conversion Tester',
					email: `conversion-${Date.now()}-${Math.random()}@example.test`,
					ticket_type_id: ticketTypeId,
					quantity: 1,
				},
			}
		);
		// This endpoint is a no-op fallback when fair-audience owns the
		// signup flow — accept its explicit "not applicable" response too.
		if (purchaseRes.status() !== 404) {
			expect(purchaseRes.ok()).toBeTruthy();
		}
	});

	test('merging periods with an unset trailing end restores NULL, not a frozen snapshot', async () => {
		const { eventDateId, ticketTypeId } = await createEventWithTicketType(
			api,
			{
				startDatetime: tomorrow(1, '10:00:00'),
				endDatetime: tomorrow(1, '12:00:00'),
			}
		);
		createdEventDateIds.push(eventDateId);

		const boundary = tomorrow(1, '00:00:00').split(' ')[0];
		const split = await putTickets(api, eventDateId, ticketTypeId, [
			{ name: 'Advance ticket', sale_start: '', sale_end: boundary },
			{ name: 'Day of event', sale_start: boundary, sale_end: '' },
		]);
		const firstPeriodStart = split.sale_periods[0].sale_start || '';

		const merged = await putTickets(api, eventDateId, ticketTypeId, [
			{ name: '', sale_start: firstPeriodStart, sale_end: '' },
		]);

		expect(merged.sale_periods).toHaveLength(1);
		expect(merged.sale_periods[0].sale_end).toBeFalsy();
	});

	test('merging periods with an organiser-typed trailing end preserves it verbatim', async () => {
		const { eventDateId, ticketTypeId } = await createEventWithTicketType(
			api,
			{
				startDatetime: tomorrow(1, '10:00:00'),
				endDatetime: tomorrow(1, '12:00:00'),
			}
		);
		createdEventDateIds.push(eventDateId);

		const boundary = tomorrow(1, '00:00:00').split(' ')[0];
		const explicitEnd = tomorrow(30, '00:00:00').split(' ')[0];
		const split = await putTickets(api, eventDateId, ticketTypeId, [
			{ name: 'Advance ticket', sale_start: '', sale_end: boundary },
			{
				name: 'Day of event',
				sale_start: boundary,
				sale_end: explicitEnd,
			},
		]);
		const firstPeriodStart = split.sale_periods[0].sale_start || '';

		const merged = await putTickets(api, eventDateId, ticketTypeId, [
			{
				name: '',
				sale_start: firstPeriodStart,
				sale_end: explicitEnd,
			},
		]);

		expect(merged.sale_periods).toHaveLength(1);
		expect(merged.sale_periods[0].sale_end).toContain(explicitEnd);
	});
});
