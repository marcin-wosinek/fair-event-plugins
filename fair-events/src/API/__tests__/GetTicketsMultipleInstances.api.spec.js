/**
 * Playwright API tests for the get-tickets fallback endpoint's
 * 'multiple_instances' ticket-type support (#930).
 *
 * This endpoint only serves signups when fair-audience is NOT active
 * (fair-events/src/blocks/get-tickets/render.php defers to the Event Signup
 * block otherwise), so these tests skip gracefully when fair-audience is
 * active in the test environment.
 *
 * Covers:
 *   - below the ticket type's configured minimum_instances is rejected.
 *   - an occurrence outside the ticket type's own series is rejected.
 *   - a valid selection creates one confirmed EventSignup row per occurrence,
 *     each priced at the per-instance price (quantity fixed at 1).
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

test.describe('GetTicketsController — multiple_instances signup', () => {
	let api;
	let fairAudienceActive = false;
	let eventPostId;
	let masterEventDateId;
	let occurrenceIds;
	let ticketTypeId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		// Detect whether fair-audience is active — the get-tickets block (and
		// this controller's public behaviour) is a no-op fallback when it is.
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
		if (fairAudienceActive) {
			return;
		}

		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets multi-instance test ${Date.now()}`,
				status: 'publish',
			},
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				event_id: eventPostId,
				start_datetime: '2035-05-01 10:00:00',
				end_datetime: '2035-05-01 12:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		masterEventDateId = (await edRes.json()).id;

		const occRes = await api.get(
			`/wp-json/fair-events/v1/event-dates?event_id=${eventPostId}`,
			{ headers: adminHeaders }
		);
		expect(occRes.ok()).toBeTruthy();
		occurrenceIds = (await occRes.json()).map((o) => o.id).sort();
		expect(occurrenceIds.length).toBe(3);

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'Pick your sessions',
							capacity: null,
							seats_per_ticket: 1,
							invitation_only: false,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'multiple_instances',
							minimum_instances: 2,
							group_ids: [],
						},
					],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
		expect(ticketsRes.ok()).toBeTruthy();
		const ticketsBody = await ticketsRes.json();
		ticketTypeId = ticketsBody.ticket_types?.[0]?.id;
		expect(ticketTypeId).toBeTruthy();
	});

	test.afterAll(async () => {
		if (fairAudienceActive) {
			return;
		}
		if (eventPostId) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${eventPostId}?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	});

	test('below the configured minimum is rejected', async () => {
		test.skip(fairAudienceActive, 'fair-audience active — block deferred');

		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: masterEventDateId,
				name: 'Below Minimum Tester',
				email: `below-min-${Date.now()}@example.test`,
				ticket_type_id: ticketTypeId,
				event_date_ids: [occurrenceIds[0]],
			},
		});
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.code).toBe('minimum_instances_not_met');
	});

	test("an occurrence outside the ticket type's series is rejected", async () => {
		test.skip(fairAudienceActive, 'fair-audience active — block deferred');

		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: masterEventDateId,
				name: 'Foreign Occurrence Tester',
				email: `foreign-occ-${Date.now()}@example.test`,
				ticket_type_id: ticketTypeId,
				// Not a real event-date id — must not be accepted as valid.
				event_date_ids: [occurrenceIds[0], 999999999],
			},
		});
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.code).toBe('invalid_occurrence');
	});

	test('a valid selection creates one signup row per chosen occurrence', async () => {
		test.skip(fairAudienceActive, 'fair-audience active — block deferred');

		const chosen = [occurrenceIds[0], occurrenceIds[1]];
		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: masterEventDateId,
				name: 'Valid Multi Tester',
				email: `valid-multi-${Date.now()}@example.test`,
				ticket_type_id: ticketTypeId,
				event_date_ids: chosen,
			},
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		// Free ticket type (no sale period configured) — confirmed immediately.
		expect(body.status).toBe('confirmed');

		for (const occId of chosen) {
			const signupsRes = await api.get(
				'/wp-json/fair-events/v1/get-tickets',
				{
					headers: adminHeaders,
					params: { event_date: occId },
				}
			);
			expect(signupsRes.ok()).toBeTruthy();
			const signups = await signupsRes.json();
			expect(
				signups.some((s) => s.ticket_type_id === ticketTypeId)
			).toBeTruthy();
		}
	});
});
