/**
 * Playwright API tests for EventDatesController — standalone category copy on first link.
 *
 * Covers the $newly_linked fix: when a standalone event date that has categories
 * in the junction table is linked to a post for the first time, those categories
 * must be copied to the post taxonomy and the junction rows must be cleared.
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
