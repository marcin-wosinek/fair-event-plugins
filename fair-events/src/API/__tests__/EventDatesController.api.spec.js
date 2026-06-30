/**
 * Playwright API tests for EventDatesController.
 *
 * Covers:
 * - Standalone category copy on first link ($newly_linked fix).
 * - Recurrence reconciliation: occurrence IDs are preserved on time/venue edits,
 *   RRULE shortening only deletes removed rows, and master time edits propagate
 *   to generated children.
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

test.describe('EventDatesController — standalone category copy on first link', () => {
	let api;
	let categoryId;
	let eventDateId;
	let postId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		// Create a WP category.
		const catRes = await api.post('/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Test Cat ${Date.now()}` },
		});
		expect(catRes.ok()).toBeTruthy();
		categoryId = (await catRes.json()).id;

		// Create a fair_event post (no event date yet — standalone path).
		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Link Target ${Date.now()}`, status: 'publish' },
		});
		expect(postRes.ok()).toBeTruthy();
		postId = (await postRes.json()).id;

		// Create a standalone event date with the category in the junction table.
		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Standalone ${Date.now()}`,
				start_datetime: '2030-01-01 10:00:00',
				end_datetime: '2030-01-01 12:00:00',
				categories: [categoryId],
			},
		});
		expect(edRes.ok()).toBeTruthy();
		const edBody = await edRes.json();
		eventDateId = edBody.id;

		// Confirm category is present in the junction table (not on a post yet).
		expect(edBody.categories.map((c) => c.id)).toContain(categoryId);
		expect(edBody.event_id).toBeNull();
	});

	test.afterAll(async () => {
		if (eventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{
					headers: adminHeaders,
				}
			);
		}
		if (postId) {
			await api.delete(`/wp-json/wp/v2/fair_event/${postId}?force=true`, {
				headers: adminHeaders,
			});
		}
		if (categoryId) {
			await api.delete(
				`/wp-json/wp/v2/categories/${categoryId}?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
	});

	test('links standalone event to post and copies categories', async () => {
		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
			{
				headers: adminHeaders,
				data: { event_id: postId },
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		// After linking, event_id is set.
		expect(body.event_id).toBe(postId);

		// Categories must appear on the event date response (sourced from the post).
		expect(body.categories.map((c) => c.id)).toContain(categoryId);
	});

	test('post has the copied category after first link', async () => {
		const res = await api.get(`/wp-json/wp/v2/fair_event/${postId}`, {
			headers: adminHeaders,
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		expect(body.categories).toContain(categoryId);
	});

	test('re-linking to a different post does not re-copy categories', async () => {
		// Create a second post (already has no categories).
		const post2Res = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Second Post ${Date.now()}`, status: 'publish' },
		});
		expect(post2Res.ok()).toBeTruthy();
		const post2Id = (await post2Res.json()).id;

		try {
			const res = await api.put(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{
					headers: adminHeaders,
					data: { event_id: post2Id },
				}
			);
			expect(res.ok()).toBeTruthy();
			const body = await res.json();
			expect(body.event_id).toBe(post2Id);

			// Second post should NOT have the category copied (only first-link fires).
			const post2Res2 = await api.get(
				`/wp-json/wp/v2/fair_event/${post2Id}`,
				{
					headers: adminHeaders,
				}
			);
			const post2Body = await post2Res2.json();
			expect(post2Body.categories).not.toContain(categoryId);
		} finally {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${post2Id}?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
	});
});

test.describe('EventDatesController — recurrence reconciliation', () => {
	let api;
	let masterEventDateId;
	let eventPostId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterEach(async () => {
		if (masterEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
				{ headers: adminHeaders }
			);
			masterEventDateId = null;
		}
		if (eventPostId) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${eventPostId}?force=true`,
				{ headers: adminHeaders }
			);
			eventPostId = null;
		}
	});

	async function createRecurringEvent(
		api,
		rrule,
		start = '2035-03-01 10:00:00'
	) {
		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Recurrence test ${Date.now()}`, status: 'publish' },
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				event_id: eventPostId,
				start_datetime: start,
				end_datetime: start.replace('10:00:00', '12:00:00'),
				rrule,
			},
		});
		expect(edRes.ok()).toBeTruthy();
		const edBody = await edRes.json();
		masterEventDateId = edBody.id;
		return edBody;
	}

	async function getOccurrences(api, eventId) {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates?event_id=${eventId}`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		return await res.json();
	}

	test('time-of-day shift preserves occurrence IDs', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });
		await createRecurringEvent(localApi, 'FREQ=WEEKLY;COUNT=3');

		const before = await getOccurrences(localApi, eventPostId);
		expect(before.length).toBe(3);
		const idsBefore = before.map((o) => o.id).sort();

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{
				headers: adminHeaders,
				data: {
					start_datetime: '2035-03-01 11:00:00',
					end_datetime: '2035-03-01 13:00:00',
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();

		const after = await getOccurrences(localApi, eventPostId);
		expect(after.length).toBe(3);
		const idsAfter = after.map((o) => o.id).sort();

		expect(idsAfter).toEqual(idsBefore);

		const starts = after.map((o) => o.start_datetime);
		expect(starts.every((s) => s.includes('11:00:00'))).toBe(true);
	});

	test('shortening RRULE deletes only removed occurrences', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });
		await createRecurringEvent(localApi, 'FREQ=WEEKLY;COUNT=4');

		const before = await getOccurrences(localApi, eventPostId);
		expect(before.length).toBe(4);
		const keptIds = before.slice(0, 2).map((o) => o.id);
		const removedIds = before.slice(2).map((o) => o.id);

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=2' },
			}
		);
		expect(putRes.ok()).toBeTruthy();

		const after = await getOccurrences(localApi, eventPostId);
		expect(after.length).toBe(2);
		const idsAfter = after.map((o) => o.id);

		keptIds.forEach((id) => expect(idsAfter).toContain(id));
		removedIds.forEach((id) => expect(idsAfter).not.toContain(id));
	});

	test('master time-of-day edit propagates to generated children', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });
		await createRecurringEvent(localApi, 'FREQ=WEEKLY;COUNT=3');

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{
				headers: adminHeaders,
				data: {
					start_datetime: '2035-03-01 14:00:00',
					end_datetime: '2035-03-01 16:00:00',
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();

		const after = await getOccurrences(localApi, eventPostId);
		expect(after.length).toBe(3);

		const starts = after.map((o) => o.start_datetime);
		expect(starts.every((s) => s.includes('14:00:00'))).toBe(true);
	});
});

test.describe('EventDatesController — impact classification (PR 2)', () => {
	let api;
	let masterEventDateId;
	let eventPostId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterEach(async () => {
		if (masterEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
				{ headers: adminHeaders }
			);
			masterEventDateId = null;
		}
		if (eventPostId) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${eventPostId}?force=true`,
				{ headers: adminHeaders }
			);
			eventPostId = null;
		}
	});

	async function createRecurringEventWithTicket(api, rrule) {
		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Impact test ${Date.now()}`, status: 'publish' },
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				event_id: eventPostId,
				start_datetime: '2035-06-01 10:00:00',
				end_datetime: '2035-06-01 12:00:00',
				rrule,
			},
		});
		expect(edRes.ok()).toBeTruthy();
		const edBody = await edRes.json();
		masterEventDateId = edBody.id;

		// Get the generated occurrences and attach a ticket type to the last one.
		const occRes = await api.get(
			`/wp-json/fair-events/v1/event-dates?event_id=${eventPostId}`,
			{ headers: adminHeaders }
		);
		expect(occRes.ok()).toBeTruthy();
		const occurrences = await occRes.json();
		// Sort ascending and pick the last generated occurrence.
		const sorted = [...occurrences].sort((a, b) =>
			a.start_datetime < b.start_datetime ? -1 : 1
		);
		const lastOccurrence = sorted[sorted.length - 1];

		// Create a ticket type on the last occurrence (makes it a "dependent").
		const ttRes = await api.post(
			`/wp-json/fair-events/v1/event-dates/${lastOccurrence.id}/ticket-types`,
			{
				headers: adminHeaders,
				data: { name: 'General', capacity: 10, sort_order: 0 },
			}
		);
		// If tickets endpoint doesn't exist in this context just skip the dependent.
		const ticketCreated = ttRes.ok();

		return { occurrences: sorted, lastOccurrence, ticketCreated };
	}

	test('time shift returns 200 with recurrence_impact summary', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });

		const postRes = await localApi.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Shift impact test ${Date.now()}`,
				status: 'publish',
			},
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await localApi.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					event_id: eventPostId,
					start_datetime: '2035-07-01 10:00:00',
					end_datetime: '2035-07-01 12:00:00',
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect(edRes.ok()).toBeTruthy();
		masterEventDateId = (await edRes.json()).id;

		// Shift start time by one hour.
		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{
				headers: adminHeaders,
				data: {
					start_datetime: '2035-07-01 11:00:00',
					end_datetime: '2035-07-01 13:00:00',
				},
			}
		);
		expect(putRes.ok()).toBeTruthy();
		const body = await putRes.json();

		// Response must include a recurrence_impact summary.
		expect(body).toHaveProperty('recurrence_impact');
		const impact = body.recurrence_impact;
		expect(impact).toHaveProperty('unchanged');
		expect(impact).toHaveProperty('shifted');
		expect(impact).toHaveProperty('added');
		expect(impact).toHaveProperty('removed');
		// A pure time shift with no RRULE change: all children are shifted, none removed.
		expect(impact.removed).toHaveLength(0);
		expect(impact.shifted.length + impact.unchanged.length).toBeGreaterThan(
			0
		);
	});

	test('shortening RRULE to remove an occurrence with a ticket type returns 409', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });
		const { occurrences, lastOccurrence, ticketCreated } =
			await createRecurringEventWithTicket(
				localApi,
				'FREQ=WEEKLY;COUNT=3'
			);

		if (!ticketCreated) {
			// Ticket type endpoint unavailable in this environment — skip dependent check.
			test.skip();
			return;
		}

		// Try to shorten to COUNT=2 — this would remove the last occurrence that has a ticket type.
		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=2' },
			}
		);

		expect(putRes.status()).toBe(409);
		const body = await putRes.json();
		expect(body.data.status).toBe(409);
		expect(body.data).toHaveProperty('impact');
		const impact = body.data.impact;
		expect(impact.removed.length).toBeGreaterThan(0);
		expect(impact.removed[0].dependents).toBeGreaterThan(0);
		expect(impact.removed[0]).toHaveProperty('id');
		expect(impact.removed[0].id).toBe(lastOccurrence.id);
	});

	test('shortening RRULE to remove an occurrence without dependents returns 200', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });

		const postRes = await localApi.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Safe shorten ${Date.now()}`, status: 'publish' },
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await localApi.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					event_id: eventPostId,
					start_datetime: '2035-08-01 10:00:00',
					end_datetime: '2035-08-01 12:00:00',
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect(edRes.ok()).toBeTruthy();
		masterEventDateId = (await edRes.json()).id;

		// Shorten to COUNT=2 — last occurrence has no dependents, so it should succeed.
		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=2' },
			}
		);
		expect(putRes.ok()).toBeTruthy();
		const body = await putRes.json();

		expect(body).toHaveProperty('recurrence_impact');
		const impact = body.recurrence_impact;
		expect(impact.removed).toHaveLength(1);
		expect(impact.removed[0].dependents).toBe(0);

		// Confirm only 2 occurrences remain.
		const occRes = await localApi.get(
			`/wp-json/fair-events/v1/event-dates?event_id=${eventPostId}`,
			{ headers: adminHeaders }
		);
		const remaining = await occRes.json();
		expect(remaining).toHaveLength(2);
	});
});
