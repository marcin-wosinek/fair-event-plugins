/**
 * Playwright API tests for whole-series ticket coverage on an irregular
 * (manually-built) series — recurrence_mode='manual', no rrule (#1158).
 *
 * This endpoint only serves signups when fair-audience is NOT active
 * (fair-events/src/blocks/get-tickets/render.php defers to the Event Signup
 * block otherwise), so these tests skip gracefully when fair-audience is
 * active in the test environment.
 *
 * Covers:
 *   - a whole_series ticket type on a manual-mode master is accepted when
 *     purchasing a non-first (generated) occurrence.
 *   - the signup persists against the child occurrence, priced from the
 *     master, confirming series resolution works the same way it does for
 *     rrule-based series (#983) even though this series has no rrule.
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

test.describe('GetTicketsController — irregular (manual) series whole_series scope', () => {
	let api;
	let fairAudienceActive = false;
	let eventPostId;
	let masterEventDateId;
	let occurrenceIds;
	let childEventDateId;
	let ticketTypeId;

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
		if (fairAudienceActive) {
			return;
		}

		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets irregular series test ${Date.now()}`,
				status: 'publish',
			},
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				event_id: eventPostId,
				start_datetime: '2035-07-01 10:00:00',
				end_datetime: '2035-07-01 12:00:00',
				recurrence_mode: 'manual',
				manual_dates: ['2035-07-01', '2035-07-10', '2035-07-20'],
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
		// A non-first occurrence — the case exercised for whole-series coverage.
		childEventDateId = occurrenceIds[1];

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'Season pass',
							capacity: null,
							invitation_only: false,
							minimum_activities: 0,
							disable_at: null,
							recurrence_scope: 'whole_series',
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
							price: 25,
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

	test('whole_series ticket type on a manual master is accepted for a generated occurrence', async () => {
		test.skip(fairAudienceActive, 'fair-audience active — block deferred');

		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: childEventDateId,
				name: 'Irregular Series Tester',
				email: `irregular-series-${Date.now()}@example.test`,
				ticket_type_id: ticketTypeId,
				quantity: 1,
			},
		});
		expect(res.ok()).toBeTruthy();
	});

	test('the signup persists against the child occurrence, priced from the master', async () => {
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
		expect(parseFloat(signup.amount)).toBe(25);
		expect(signup.status).toBe('pending_payment');
	});
});
