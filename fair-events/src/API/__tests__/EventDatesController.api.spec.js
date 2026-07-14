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

test.describe('EventDatesController — create_item with categories + rrule (quick add)', () => {
	let api;
	let categoryId;
	let masterEventDateId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const catRes = await api.post('/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Quick Add Cat ${Date.now()}` },
		});
		expect(catRes.ok()).toBeTruthy();
		categoryId = (await catRes.json()).id;
	});

	test.afterEach(async () => {
		if (masterEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
				{ headers: adminHeaders }
			);
			masterEventDateId = null;
		}
	});

	test.afterAll(async () => {
		if (categoryId) {
			await api.delete(
				`/wp-json/wp/v2/categories/${categoryId}?force=true`,
				{ headers: adminHeaders }
			);
		}
	});

	test('a standalone create with categories + rrule generates occurrences that all carry the categories', async () => {
		const res = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Quick add ${Date.now()}`,
				start_datetime: '2036-01-01 10:00:00',
				end_datetime: '2036-01-01 12:00:00',
				link_type: 'none',
				categories: [categoryId],
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		masterEventDateId = body.id;

		expect(body.occurrence_type).toBe('master');
		expect(body.rrule).toBe('FREQ=WEEKLY;COUNT=3');
		expect(body.generated_occurrences.length).toBe(2);
		expect(body.categories.map((c) => c.id)).toContain(categoryId);

		for (const occ of body.generated_occurrences) {
			const occRes = await api.get(
				`/wp-json/fair-events/v1/event-dates/${occ.id}`,
				{ headers: adminHeaders }
			);
			expect(occRes.ok()).toBeTruthy();
			const occBody = await occRes.json();
			expect(occBody.categories.map((c) => c.id)).toContain(categoryId);
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

	async function getMaster(api, masterId) {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${masterId}`,
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

		const before = await getMaster(localApi, masterEventDateId);
		expect(before.generated_occurrences.length).toBe(2);
		const idsBefore = [
			before.id,
			...before.generated_occurrences.map((o) => o.id),
		].sort();

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

		const after = await getMaster(localApi, masterEventDateId);
		const idsAfter = [
			after.id,
			...after.generated_occurrences.map((o) => o.id),
		].sort();

		expect(idsAfter).toEqual(idsBefore);

		const starts = after.generated_occurrences.map((o) => o.start_datetime);
		expect(starts.every((s) => s.includes('11:00:00'))).toBe(true);
	});

	test('shortening RRULE soft-cancels removed occurrences instead of deleting them', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });
		await createRecurringEvent(localApi, 'FREQ=WEEKLY;COUNT=4');

		const before = await getMaster(localApi, masterEventDateId);
		expect(before.generated_occurrences.length).toBe(3);
		const keptIds = before.generated_occurrences
			.slice(0, 1)
			.map((o) => o.id);
		const cancelledIds = before.generated_occurrences
			.slice(1)
			.map((o) => o.id);

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=2' },
			}
		);
		expect(putRes.ok()).toBeTruthy();

		const after = await getMaster(localApi, masterEventDateId);
		// Ids survive — soft-cancelled, not deleted.
		const idsAfter = after.generated_occurrences.map((o) => o.id);
		keptIds.forEach((id) => expect(idsAfter).toContain(id));
		cancelledIds.forEach((id) => expect(idsAfter).toContain(id));

		const byId = Object.fromEntries(
			after.generated_occurrences.map((o) => [o.id, o])
		);
		keptIds.forEach((id) => expect(byId[id].status).toBe('active'));
		cancelledIds.forEach((id) => expect(byId[id].status).toBe('cancelled'));
		cancelledIds.forEach((id) =>
			expect(after.cancelled_dates.length).toBeGreaterThan(0)
		);
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

		const after = await getMaster(localApi, masterEventDateId);
		expect(after.generated_occurrences.length).toBe(2);

		const starts = after.generated_occurrences.map((o) => o.start_datetime);
		expect(starts.every((s) => s.includes('14:00:00'))).toBe(true);
	});
});

test.describe('EventDatesController — ending a series', () => {
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
		start = '2035-04-01 10:00:00'
	) {
		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `End series test ${Date.now()}`, status: 'publish' },
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

	async function getMaster(api, masterId) {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${masterId}`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		return await res.json();
	}

	test('PUT rrule: "" clears the series and removes generated occurrences', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });
		const master = await createRecurringEvent(
			localApi,
			'FREQ=WEEKLY;COUNT=3'
		);
		expect(master.generated_occurrences.length).toBe(2);

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{ headers: adminHeaders, data: { rrule: '' } }
		);
		expect(putRes.ok()).toBeTruthy();

		const after = await getMaster(localApi, masterEventDateId);
		expect(after.rrule).toBeNull();
		expect(after.occurrence_type).toBe('single');
		expect(after.recurrence_mode).toBe('none');
		expect(after.generated_occurrences.length).toBe(0);
	});

	test('a details PUT that omits rrule leaves an existing series intact', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });
		const master = await createRecurringEvent(
			localApi,
			'FREQ=WEEKLY;COUNT=3'
		);
		expect(master.generated_occurrences.length).toBe(2);

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{
				headers: adminHeaders,
				data: { title: 'Renamed via details save' },
			}
		);
		expect(putRes.ok()).toBeTruthy();

		const after = await getMaster(localApi, masterEventDateId);
		expect(after.rrule).toBe('FREQ=WEEKLY;COUNT=3');
		expect(after.occurrence_type).toBe('master');
		expect(after.generated_occurrences.length).toBe(2);
	});
});

test.describe('EventDatesController — cancel/restore via toggle-exdate', () => {
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

	test('cancelling a date is a reversible status flip that keeps a dependent ticket type', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });

		const postRes = await localApi.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Toggle test ${Date.now()}`, status: 'publish' },
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await localApi.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					event_id: eventPostId,
					start_datetime: '2035-09-03 10:00:00',
					end_datetime: '2035-09-03 12:00:00',
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect(edRes.ok()).toBeTruthy();
		const master = await edRes.json();
		masterEventDateId = master.id;

		const targetOccurrence = master.generated_occurrences[0];

		// Attach a ticket type to the target occurrence to prove it survives cancellation.
		const ttRes = await localApi.post(
			`/wp-json/fair-events/v1/event-dates/${targetOccurrence.id}/ticket-types`,
			{
				headers: adminHeaders,
				data: { name: 'General', capacity: 10, sort_order: 0 },
			}
		);
		const ticketCreated = ttRes.ok();
		if (!ticketCreated) {
			test.skip();
			return;
		}

		const targetDate = targetOccurrence.start_datetime.split(' ')[0];

		// Cancel.
		const cancelRes = await localApi.post(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}/toggle-exdate`,
			{ headers: adminHeaders, data: { date: targetDate } }
		);
		expect(cancelRes.ok()).toBeTruthy();
		const afterCancel = await cancelRes.json();
		const cancelledOcc = afterCancel.generated_occurrences.find(
			(o) => o.id === targetOccurrence.id
		);
		expect(cancelledOcc.status).toBe('cancelled');
		expect(afterCancel.cancelled_dates).toContain(targetDate);

		// The dependent ticket type must still exist — cancellation is non-destructive.
		const ttGetRes = await localApi.get(
			`/wp-json/fair-events/v1/event-dates/${targetOccurrence.id}/ticket-types`,
			{ headers: adminHeaders }
		);
		expect(ttGetRes.ok()).toBeTruthy();
		expect((await ttGetRes.json()).length).toBeGreaterThan(0);

		// Restore.
		const restoreRes = await localApi.post(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}/toggle-exdate`,
			{ headers: adminHeaders, data: { date: targetDate } }
		);
		expect(restoreRes.ok()).toBeTruthy();
		const afterRestore = await restoreRes.json();
		const restoredOcc = afterRestore.generated_occurrences.find(
			(o) => o.id === targetOccurrence.id
		);
		expect(restoredOcc.status).toBe('active');
		expect(afterRestore.cancelled_dates).not.toContain(targetDate);
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

	test('shortening RRULE to remove an occurrence with a ticket type soft-cancels it (non-destructive)', async ({
		request: req,
	}) => {
		const localApi = await req.newContext({ baseURL: BASE_URL });
		const { lastOccurrence, ticketCreated } =
			await createRecurringEventWithTicket(
				localApi,
				'FREQ=WEEKLY;COUNT=3'
			);

		if (!ticketCreated) {
			// Ticket type endpoint unavailable in this environment — skip dependent check.
			test.skip();
			return;
		}

		// Shorten to COUNT=2 — this removes the last occurrence from the rule,
		// which now soft-cancels it instead of blocking the change.
		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=2' },
			}
		);

		expect(putRes.ok()).toBeTruthy();
		const body = await putRes.json();
		expect(body.recurrence_impact.removed.length).toBeGreaterThan(0);

		// The removed occurrence still exists, cancelled — its ticket type survives.
		const masterRes = await localApi.get(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{ headers: adminHeaders }
		);
		const masterBody = await masterRes.json();
		const removedOcc = masterBody.generated_occurrences.find(
			(o) => o.id === lastOccurrence.id
		);
		expect(removedOcc).toBeDefined();
		expect(removedOcc.status).toBe('cancelled');

		const ttRes = await localApi.get(
			`/wp-json/fair-events/v1/event-dates/${lastOccurrence.id}/ticket-types`,
			{ headers: adminHeaders }
		);
		expect(ttRes.ok()).toBeTruthy();
		expect((await ttRes.json()).length).toBeGreaterThan(0);
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

		// Confirm only 1 occurrence is still active (2 total including the master).
		const masterRes = await localApi.get(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
			{ headers: adminHeaders }
		);
		const masterBody = await masterRes.json();
		const active = masterBody.generated_occurrences.filter(
			(o) => o.status === 'active'
		);
		expect(active).toHaveLength(1);
	});
});

test.describe('EventDatesController — title validation', () => {
	let api;
	let eventDateId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterEach(async () => {
		if (eventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{ headers: adminHeaders }
			);
			eventDateId = null;
		}
	});

	test('rejects create with an empty title', async () => {
		const res = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: '',
				start_datetime: '2030-01-01 10:00:00',
				end_datetime: '2030-01-01 12:00:00',
			},
		});
		expect(res.status()).toBe(400);
	});

	test('rejects create with a whitespace-only title', async () => {
		const res = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: '   ',
				start_datetime: '2030-01-01 10:00:00',
				end_datetime: '2030-01-01 12:00:00',
			},
		});
		expect(res.status()).toBe(400);
	});

	test('rejects update that clears the title', async () => {
		const createRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Title Validation ${Date.now()}`,
					start_datetime: '2030-01-01 10:00:00',
					end_datetime: '2030-01-01 12:00:00',
				},
			}
		);
		expect(createRes.ok()).toBeTruthy();
		eventDateId = (await createRes.json()).id;

		const updateRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
			{
				headers: adminHeaders,
				data: { title: '   ' },
			}
		);
		expect(updateRes.status()).toBe(400);
	});
});
