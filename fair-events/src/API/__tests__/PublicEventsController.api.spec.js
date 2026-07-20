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
				title: `Public feed recurring post-link test ${Date.now()}`,
				link_type: 'post',
				start_datetime: '2035-07-01 10:00:00',
				end_datetime: '2035-07-01 12:00:00',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		const masterId = (await edRes.json()).id;

		// Link to the post and set the rrule in one PUT — this is the update
		// path that actually regenerates occurrences (see
		// EventDatesController::update_item()); the create endpoint doesn't
		// wire event_id through.
		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${masterId}`,
			{
				headers: adminHeaders,
				data: {
					event_id: eventPostId,
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect(linkRes.ok()).toBeTruthy();
		const linkBody = await linkRes.json();
		expect(linkBody.generated_occurrences.length).toBe(2);

		occurrenceIds = [
			masterId,
			...linkBody.generated_occurrences.map((o) => o.id),
		].sort((a, b) => a - b);
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
			expect(event.uid.startsWith('fair_event_')).toBe(true);

			// Canonical URL form: only generated occurrences get the
			// `?event_date=` disambiguator; the master occurrence uses the
			// plain permalink (see EventDates::get_display_url()).
			if ('generated' === event.occurrence_type) {
				expect(event.url).toContain(
					`event_date=${event.event_date_id}`
				);
			} else {
				expect(event.url).not.toContain('event_date=');
			}
		}
	});

	test('feed url matches the resolver display_url for each occurrence', async () => {
		const feedRes = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-07-01&end_date=2035-07-31&per_page=500'
		);
		expect(feedRes.ok()).toBeTruthy();
		const feedBody = await feedRes.json();

		for (const occurrenceId of occurrenceIds) {
			const edRes = await api.get(
				`/wp-json/fair-events/v1/event-dates/${occurrenceId}`,
				{ headers: adminHeaders }
			);
			expect(edRes.ok()).toBeTruthy();
			const eventDate = await edRes.json();

			const feedEvent = feedBody.events.find(
				(e) => e.event_date_id === occurrenceId
			);

			expect(feedEvent).toBeTruthy();
			expect(feedEvent.url).toBe(eventDate.display_url);
		}
	});
});

test.describe('PublicEventsController — standalone events', () => {
	let api;
	let eventDateId;
	let categoryId;
	let otherCategoryId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const categoryRes = await api.post('/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Public feed standalone test ${Date.now()}` },
		});
		expect(categoryRes.ok()).toBeTruthy();
		categoryId = (await categoryRes.json()).id;

		const otherCategoryRes = await api.post('/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Public feed standalone unused ${Date.now()}` },
		});
		expect(otherCategoryRes.ok()).toBeTruthy();
		otherCategoryId = (await otherCategoryRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Public feed standalone test ${Date.now()}`,
				start_datetime: '2035-08-01 10:00:00',
				end_datetime: '2035-08-01 12:00:00',
				link_type: 'external',
				external_url: 'https://example.com/standalone-test',
				categories: [categoryId],
			},
		});
		expect(edRes.ok()).toBeTruthy();
		eventDateId = (await edRes.json()).id;
	});

	test.afterAll(async () => {
		if (eventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{ headers: adminHeaders }
			);
		}
		if (categoryId) {
			await api.delete(
				`/wp-json/wp/v2/categories/${categoryId}?force=true`,
				{ headers: adminHeaders }
			);
		}
		if (otherCategoryId) {
			await api.delete(
				`/wp-json/wp/v2/categories/${otherCategoryId}?force=true`,
				{ headers: adminHeaders }
			);
		}
	});

	test('standalone external event carries its url, categories, and uid through the feed', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-08-01&end_date=2035-08-31&per_page=500'
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		const event = body.events.find((e) => e.event_date_id === eventDateId);

		expect(event).toBeTruthy();
		expect(event.uid.startsWith('standalone_')).toBe(true);
		expect(event.url).toBe('https://example.com/standalone-test');
		expect(event.categories.map((c) => c.id)).toContain(categoryId);

		const edRes = await api.get(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
			{ headers: adminHeaders }
		);
		expect(edRes.ok()).toBeTruthy();
		const eventDate = await edRes.json();
		expect(event.url).toBe(eventDate.display_url);
	});

	test('external-link event carries location as an online marker', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-08-01&end_date=2035-08-31&per_page=500'
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		const event = body.events.find((e) => e.event_date_id === eventDateId);

		expect(event).toBeTruthy();
		expect(event.location).toEqual({
			online: true,
			url: 'https://example.com/standalone-test',
		});
	});

	test('categories filter narrows the feed to matching standalone events', async () => {
		const category = await (
			await api.get(`/wp-json/wp/v2/categories/${categoryId}`, {
				headers: adminHeaders,
			})
		).json();

		const matchingRes = await api.get(
			`/wp-json/fair-events/v1/events?start_date=2035-08-01&end_date=2035-08-31&categories=${category.slug}&per_page=500`
		);
		expect(matchingRes.ok()).toBeTruthy();
		const matchingBody = await matchingRes.json();
		expect(
			matchingBody.events.some((e) => e.event_date_id === eventDateId)
		).toBe(true);

		const otherCategory = await (
			await api.get(`/wp-json/wp/v2/categories/${otherCategoryId}`, {
				headers: adminHeaders,
			})
		).json();

		const nonMatchingRes = await api.get(
			`/wp-json/fair-events/v1/events?start_date=2035-08-01&end_date=2035-08-31&categories=${otherCategory.slug}&per_page=500`
		);
		expect(nonMatchingRes.ok()).toBeTruthy();
		const nonMatchingBody = await nonMatchingRes.json();
		expect(
			nonMatchingBody.events.some((e) => e.event_date_id === eventDateId)
		).toBe(false);
	});
});

test.describe('PublicEventsController — location field', () => {
	let api;
	let addressEventDateId;
	let noLocationEventDateId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const addressRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Public feed address test ${Date.now()}`,
					start_datetime: '2035-08-10 10:00:00',
					end_datetime: '2035-08-10 12:00:00',
					link_type: 'none',
				},
			}
		);
		expect(addressRes.ok()).toBeTruthy();
		addressEventDateId = (await addressRes.json()).id;

		// The create endpoint doesn't wire `address` through — a PUT is
		// needed, same quirk as `event_id` (see the recurring-occurrences
		// test above).
		const addressUpdateRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${addressEventDateId}`,
			{
				headers: adminHeaders,
				data: { address: 'Calle X 1, Madrid' },
			}
		);
		expect(addressUpdateRes.ok()).toBeTruthy();

		const noLocationRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Public feed no-location test ${Date.now()}`,
					start_datetime: '2035-08-11 10:00:00',
					end_datetime: '2035-08-11 12:00:00',
					link_type: 'none',
				},
			}
		);
		expect(noLocationRes.ok()).toBeTruthy();
		noLocationEventDateId = (await noLocationRes.json()).id;
	});

	test.afterAll(async () => {
		if (addressEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${addressEventDateId}`,
				{ headers: adminHeaders }
			);
		}
		if (noLocationEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${noLocationEventDateId}`,
				{ headers: adminHeaders }
			);
		}
	});

	test('free-text address resolves to a location object', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-08-10&end_date=2035-08-10&per_page=500'
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		const event = body.events.find(
			(e) => e.event_date_id === addressEventDateId
		);
		expect(event).toBeTruthy();
		expect(event.location).toEqual({ address: 'Calle X 1, Madrid' });
	});

	test('event with no location omits the field entirely', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-08-11&end_date=2035-08-11&per_page=500'
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		const event = body.events.find(
			(e) => e.event_date_id === noLocationEventDateId
		);
		expect(event).toBeTruthy();
		expect(event).not.toHaveProperty('location');
	});
});
