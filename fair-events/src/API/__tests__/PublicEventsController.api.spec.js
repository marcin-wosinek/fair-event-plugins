/**
 * Playwright API tests for PublicEventsController's handling of generated
 * occurrences on a post-linked recurring event (#1090).
 *
 * Generated occurrence rows don't inherit `event_id` from their master, so
 * the public events feed used to leave `url: ""` for every occurrence after
 * the first. These tests assert the feed resolves the link through the
 * master's linked post instead.
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

test.describe('PublicEventsController — recurring post-linked occurrences', () => {
	let api;
	let eventPostId;
	let occurrenceIds;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Public feed recurring post-link test ${Date.now()}`,
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
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		});
		expect(edRes.ok()).toBeTruthy();

		const occRes = await api.get(
			`/wp-json/fair-events/v1/event-dates?event_id=${eventPostId}`,
			{ headers: adminHeaders }
		);
		expect(occRes.ok()).toBeTruthy();
		const occurrences = await occRes.json();
		expect(occurrences.length).toBe(3);
		occurrenceIds = occurrences.map((o) => o.id).sort((a, b) => a - b);
	});

	test.afterAll(async () => {
		if (eventPostId) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${eventPostId}?force=true`,
				{ headers: adminHeaders }
			);
		}
	});

	test('generated occurrences get a non-empty, resolvable url', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-07-01&end_date=2035-07-31&per_page=500'
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		const eventsForOccurrences = occurrenceIds.map((occurrenceId) =>
			body.events.find((e) => e.event_date_id === occurrenceId)
		);

		for (const event of eventsForOccurrences) {
			expect(event).toBeTruthy();
			expect(event.url).toBeTruthy();
			expect(event.url).toContain(`event_date=${event.event_date_id}`);
			expect(event.uid.startsWith('fair_event_')).toBe(true);
		}
	});
});
