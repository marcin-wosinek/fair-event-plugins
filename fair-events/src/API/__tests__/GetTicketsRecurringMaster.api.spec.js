/**
 * Playwright API tests for the get-tickets fallback endpoint's master-pivot
 * support for recurring events (#983).
 *
 * This endpoint only serves signups when fair-audience is NOT active
 * (fair-events/src/blocks/get-tickets/render.php defers to the Event Signup
 * block otherwise), so these tests skip gracefully when fair-audience is
 * active in the test environment.
 *
 * Covers:
 *   - a ticket type configured on the series master is accepted when
 *     purchasing a non-first (child) occurrence.
 *   - the resulting signup row persists against the child occurrence, not
 *     the master.
 *   - a price configured on the master resolves for a purchase against a
 *     child occurrence.
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

test.describe('GetTicketsController — recurring series master pivot', () => {
	let api;
	let fairAudienceActive = false;
	let eventPostId;
	let masterEventDateId;
	let occurrenceIds;
	let childEventDateId;
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
				title: `Get-tickets recurring master test ${Date.now()}`,
				status: 'publish',
			},
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				event_id: eventPostId,
				start_datetime: '2035-06-01 10:00:00',
				end_datetime: '2035-06-01 12:00:00',
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
		// A non-first occurrence — the case that was previously broken.
		childEventDateId = occurrenceIds[1];

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'Single session',
							capacity: null,
							seats_per_ticket: 1,
							invitation_only: false,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'single_instance',
							group_ids: [],
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
							price: 12.5,
						},
					],
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

	test('master-owned ticket type is accepted for a child occurrence and priced', async () => {
		test.skip(fairAudienceActive, 'fair-audience active — block deferred');

		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: childEventDateId,
				name: 'Recurring Master Tester',
				email: `recurring-master-${Date.now()}@example.test`,
				ticket_type_id: ticketTypeId,
				quantity: 1,
			},
		});
		// Today's bug returns 400 invalid_ticket_type here — must succeed instead.
		expect(res.ok()).toBeTruthy();
	});

	test('the signup persists against the child occurrence, priced from the master, not the master row', async () => {
		test.skip(fairAudienceActive, 'fair-audience active — block deferred');

		const signupsRes = await api.get(
			'/wp-json/fair-events/v1/get-tickets',
			{
				headers: adminHeaders,
				params: { event_date: childEventDateId },
			}
		);
		expect(signupsRes.ok()).toBeTruthy();
		const signups = await signupsRes.json();
		const signup = signups.find((s) => s.ticket_type_id === ticketTypeId);
		expect(signup).toBeTruthy();
		// Server-resolved amount confirms the price lookup pivoted to the master.
		expect(parseFloat(signup.amount)).toBe(12.5);
		expect(signup.status).toBe('pending_payment');

		const masterSignupsRes = await api.get(
			'/wp-json/fair-events/v1/get-tickets',
			{
				headers: adminHeaders,
				params: { event_date: masterEventDateId },
			}
		);
		expect(masterSignupsRes.ok()).toBeTruthy();
		const masterSignups = await masterSignupsRes.json();
		expect(
			masterSignups.some((s) => s.ticket_type_id === ticketTypeId)
		).toBeFalsy();
	});
});
