/**
 * Playwright API tests for the sibling-occurrences endpoint on
 * EventDatesController.
 *
 * Exercises GET /fair-events/v1/event-dates/{id}/siblings against a live
 * WordPress instance.
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

test.describe('EventDatesController — siblings', () => {
	let api;
	let eventPostId;
	let masterEventDateId;
	let generatedIds;
	let standaloneEventDateId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Siblings test ${Date.now()}`, status: 'publish' },
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				event_id: eventPostId,
				start_datetime: '2036-04-01 10:00:00',
				end_datetime: '2036-04-01 12:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		const edBody = await edRes.json();
		masterEventDateId = edBody.id;
		generatedIds = edBody.generated_occurrences.map((o) => o.id);
		expect(generatedIds.length).toBe(2);

		const standaloneRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Standalone sibling test ${Date.now()}`,
					start_datetime: '2036-05-01 10:00:00',
				},
			}
		);
		expect(standaloneRes.ok()).toBeTruthy();
		standaloneEventDateId = (await standaloneRes.json()).id;
	});

	test.afterAll(async () => {
		if (masterEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
				{ headers: adminHeaders }
			);
		}
		if (standaloneEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${standaloneEventDateId}`,
				{ headers: adminHeaders }
			);
		}
		if (eventPostId) {
			await api.delete(`/wp-json/wp/v2/fair_event/${eventPostId}`, {
				headers: adminHeaders,
				params: { force: 'true' },
			});
		}
		await api.dispose();
	});

	test('returns master plus generated occurrences from the master id', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}/siblings`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		const ids = body.map((s) => s.id);
		expect(ids).toContain(masterEventDateId);
		generatedIds.forEach((id) => expect(ids).toContain(id));
		expect(body.length).toBe(3);

		const master = body.find((s) => s.id === masterEventDateId);
		expect(master.occurrence_type).toBe('master');
	});

	test('returns the same set from a generated occurrence id', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${generatedIds[0]}/siblings`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		const ids = body.map((s) => s.id);
		expect(ids).toContain(masterEventDateId);
		generatedIds.forEach((id) => expect(ids).toContain(id));
		expect(body.length).toBe(3);
	});

	test('standalone (single) event returns only itself', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${standaloneEventDateId}/siblings`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		expect(body.length).toBe(1);
		expect(body[0].id).toBe(standaloneEventDateId);
	});

	test('unknown event date returns 404', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/event-dates/999999999/siblings',
			{ headers: adminHeaders }
		);
		expect(res.status()).toBe(404);
	});

	test('unauthenticated request is rejected', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${masterEventDateId}/siblings`
		);
		expect(res.status()).toBeGreaterThanOrEqual(401);
		expect(res.status()).toBeLessThan(404);
	});
});
