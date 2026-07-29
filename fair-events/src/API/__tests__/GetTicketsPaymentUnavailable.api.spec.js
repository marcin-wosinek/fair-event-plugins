/**
 * Playwright API tests for the get-tickets fallback endpoint's fail-closed
 * behaviour when online payments can't be collected (#1177).
 *
 * Like fair-audience's EventSignupSlidingScale spec, this assumes the dev
 * stack has no payment connector configured: a priced signup must be rejected
 * up front with 503 payment_unavailable, creating no signup (and therefore no
 * transaction) row, so a paid ticket is never confirmed for free and no
 * orphaned pending_payment row is left behind. A free (price-0) signup on the
 * same event must still confirm.
 *
 * Covers every priced path the ticket calls out: single instance, whole
 * series, and multiple instances.
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

function uniqueEmail(prefix) {
	return `${prefix}-${Date.now()}-${Math.floor(
		Math.random() * 1e6
	)}@example.test`;
}

test.describe('GetTicketsController — payments unavailable (fail closed)', () => {
	let api;
	let eventPostId;
	let masterEventDateId;
	let occurrenceIds;
	let singleTypeId;
	let seriesTypeId;
	let multiTypeId;

	// Count signup rows for an event date via the admin GET route, so a
	// rejection can be proven to have written nothing.
	async function countSignups(eventDateId) {
		const res = await api.get('/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		});
		expect(res.ok()).toBeTruthy();
		return (await res.json()).length;
	}

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets payments-unavailable test ${Date.now()}`,
				status: 'publish',
			},
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets payments-unavailable test ${Date.now()}`,
				link_type: 'post',
				start_datetime: '2035-05-01 10:00:00',
				end_datetime: '2035-05-01 12:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		const edBody = await edRes.json();
		masterEventDateId = edBody.id;

		// The create endpoint doesn't wire event_id through — a PUT is
		// needed to actually link the post (see CalendarFeedController.api.spec.js
		// for the same quirk).
		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{
				headers: adminHeaders,
				data: { event_id: eventPostId },
			}
		);
		expect(linkRes.ok()).toBeTruthy();

		// generated_occurrences comes straight off the create response
		// (master + 2 generated for COUNT=3 / 3 manual dates) — the
		// event_id query-filter on the list route doesn't actually filter
		// (a separate pre-existing bug), so deriving from edRes avoids it.
		occurrenceIds = [
			masterEventDateId,
			...edBody.generated_occurrences.map((o) => o.id),
		].sort();
		expect(occurrenceIds.length).toBe(3);

		// Three priced ticket types — one per purchase path — plus an
		// always-on sale period so each price resolves server-side.
		const baseType = {
			capacity: null,
			minimum_activities: 0,
			disable_at: null,
			group_ids: [],
		};
		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							...baseType,
							name: 'Single session',
							recurrence_scope: 'single_instance',
						},
						{
							...baseType,
							name: 'Series pass',
							recurrence_scope: 'whole_series',
						},
						{
							...baseType,
							name: 'Pick your sessions',
							recurrence_scope: 'multiple_instances',
							minimum_instances: 2,
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
							price: 20,
						},
						{
							ticket_type_index: 1,
							sale_period_index: 0,
							price: 30,
						},
						{
							ticket_type_index: 2,
							sale_period_index: 0,
							price: 10,
						},
					],
					settings: {},
				},
			}
		);
		expect(ticketsRes.ok()).toBeTruthy();
		const types = (await ticketsRes.json()).ticket_types || [];
		singleTypeId = types.find(
			(t) => t.recurrence_scope === 'single_instance'
		)?.id;
		seriesTypeId = types.find(
			(t) => t.recurrence_scope === 'whole_series'
		)?.id;
		multiTypeId = types.find(
			(t) => t.recurrence_scope === 'multiple_instances'
		)?.id;
		expect(singleTypeId).toBeTruthy();
		expect(seriesTypeId).toBeTruthy();
		expect(multiTypeId).toBeTruthy();
	});

	test.afterAll(async () => {
		if (eventPostId) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${eventPostId}?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	});

	test('a paid single-instance signup is rejected 503 and writes nothing', async () => {
		const before = await countSignups(masterEventDateId);
		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: masterEventDateId,
				name: 'Single Tester',
				email: uniqueEmail('single'),
				ticket_type_id: singleTypeId,
				quantity: 1,
			},
		});
		expect(res.status()).toBe(503);
		expect((await res.json()).code).toBe('payment_unavailable');
		expect(await countSignups(masterEventDateId)).toBe(before);
	});

	test('a paid whole-series signup is rejected 503 and writes nothing', async () => {
		const before = await countSignups(masterEventDateId);
		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: masterEventDateId,
				name: 'Series Tester',
				email: uniqueEmail('series'),
				ticket_type_id: seriesTypeId,
				quantity: 1,
			},
		});
		expect(res.status()).toBe(503);
		expect((await res.json()).code).toBe('payment_unavailable');
		expect(await countSignups(masterEventDateId)).toBe(before);
	});

	test('a paid multiple-instances signup is rejected 503 and writes nothing', async () => {
		const chosen = [occurrenceIds[0], occurrenceIds[1]];
		const before = await Promise.all(chosen.map(countSignups));
		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: masterEventDateId,
				name: 'Multi Tester',
				email: uniqueEmail('multi'),
				ticket_type_id: multiTypeId,
				event_date_ids: chosen,
			},
		});
		expect(res.status()).toBe(503);
		expect((await res.json()).code).toBe('payment_unavailable');
		const after = await Promise.all(chosen.map(countSignups));
		expect(after).toEqual(before);
	});

	test('a free signup on the same event still confirms', async () => {
		// No ticket type → amount 0 → free path, unaffected by the guard.
		const res = await api.post('/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: masterEventDateId,
				name: 'Free Tester',
				email: uniqueEmail('free'),
			},
		});
		expect(res.ok()).toBeTruthy();
		expect((await res.json()).status).toBe('confirmed');
	});
});
