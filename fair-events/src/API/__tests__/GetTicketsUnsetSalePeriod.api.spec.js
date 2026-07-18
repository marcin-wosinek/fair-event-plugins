/**
 * Playwright API tests for lazy default sale-period resolution (#1189).
 *
 * When a ticket type's sale period is left unset (no sale_start/sale_end
 * stored), on-sale evaluation must resolve a default lazily — open start,
 * end at the day after the last occurrence — rather than treating the
 * unset window as closed.
 *
 * This endpoint only serves signups when fair-audience is NOT active
 * (fair-events/src/blocks/get-tickets/render.php defers to the Event Signup
 * block otherwise), so these tests skip gracefully when fair-audience is
 * active in the test environment.
 *
 * Covers:
 *   - single, non-recurring event with an unset window is purchasable.
 *   - recurring event with an unset window is purchasable through the
 *     day after its last (generated) occurrence.
 *   - a series entirely in the past with an unset window is still
 *     purchasable (the existing continues-fallback semantics), never an
 *     inverted/empty range.
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
 * Creates an event date (optionally recurring) with a single ticket type
 * and an unset sale period (no sale_start/sale_end), and a price attached.
 */
async function createEventWithUnsetWindow(
	api,
	{ startDatetime, endDatetime, rrule }
) {
	const data = {
		title: `Unset sale-period test ${Date.now()}-${Math.random()}`,
		start_datetime: startDatetime,
		end_datetime: endDatetime,
	};
	if (rrule) data.rrule = rrule;

	const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
		headers: adminHeaders,
		data,
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
				// Unset window: no sale_start/sale_end stored at all.
				sale_periods: [
					{
						name: '',
						sale_start: '',
						sale_end: '',
					},
				],
				prices: [
					{
						ticket_type_index: 0,
						sale_period_index: 0,
						price: 9,
					},
				],
				settings: {},
			},
		}
	);
	expect(ticketsRes.ok()).toBeTruthy();
	const body = await ticketsRes.json();
	const ticketTypeId = body.ticket_types?.[0]?.id;
	expect(ticketTypeId).toBeTruthy();
	// The stored window really is unset — no eager persistence of a computed date.
	expect(body.sale_periods?.[0]?.sale_start).toBeFalsy();
	expect(body.sale_periods?.[0]?.sale_end).toBeFalsy();

	return { eventDateId, ticketTypeId };
}

async function purchase(api, eventDateId, ticketTypeId) {
	return api.post('/wp-json/fair-events/v1/get-tickets', {
		data: {
			event_date_id: eventDateId,
			name: 'Unset Window Tester',
			email: `unset-window-${Date.now()}-${Math.random()}@example.test`,
			ticket_type_id: ticketTypeId,
			quantity: 1,
		},
	});
}

test.describe('GetTicketsController — lazy default sale-period resolution', () => {
	let api;
	let fairAudienceActive = false;
	const createdEventDateIds = [];

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
	});

	test.afterAll(async () => {
		for (const id of createdEventDateIds) {
			await api.delete(`/wp-json/fair-events/v1/event-dates/${id}`, {
				headers: adminHeaders,
			});
		}
		await api.dispose();
	});

	test('single, non-recurring event with an unset window is purchasable', async () => {
		test.skip(fairAudienceActive, 'fair-audience active — block deferred');

		const { eventDateId, ticketTypeId } = await createEventWithUnsetWindow(
			api,
			{
				// Ends tomorrow, so "today" is well inside the default window
				// (open start → day after the event).
				startDatetime: tomorrow(1, '10:00:00'),
				endDatetime: tomorrow(1, '12:00:00'),
			}
		);
		createdEventDateIds.push(eventDateId);

		const res = await purchase(api, eventDateId, ticketTypeId);
		expect(res.ok()).toBeTruthy();
	});

	test('recurring event with an unset window is purchasable through the day after its last occurrence', async () => {
		test.skip(fairAudienceActive, 'fair-audience active — block deferred');

		const { eventDateId, ticketTypeId } = await createEventWithUnsetWindow(
			api,
			{
				startDatetime: tomorrow(1, '10:00:00'),
				endDatetime: tomorrow(1, '12:00:00'),
				rrule: 'FREQ=WEEKLY;COUNT=3',
			}
		);
		createdEventDateIds.push(eventDateId);

		// Purchasing against the master row resolves the default from the
		// series' last (generated) occurrence, not the master's own end.
		const res = await purchase(api, eventDateId, ticketTypeId);
		expect(res.ok()).toBeTruthy();
	});

	test('a series entirely in the past with an unset window is still purchasable, never inverted', async () => {
		test.skip(fairAudienceActive, 'fair-audience active — block deferred');

		const { eventDateId, ticketTypeId } = await createEventWithUnsetWindow(
			api,
			{
				startDatetime: '2020-01-01 10:00:00',
				endDatetime: '2020-01-01 12:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			}
		);
		createdEventDateIds.push(eventDateId);

		const res = await purchase(api, eventDateId, ticketTypeId);
		expect(res.ok()).toBeTruthy();
	});
});

/**
 * Formats a datetime `daysAhead` days from now, in 'Y-m-d HH:MM:SS' form.
 */
function tomorrow(daysAhead, time) {
	const d = new Date();
	d.setDate(d.getDate() + daysAhead);
	const y = d.getFullYear();
	const m = String(d.getMonth() + 1).padStart(2, '0');
	const day = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${day} ${time}`;
}
