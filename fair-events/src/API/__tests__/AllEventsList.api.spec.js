/**
 * Playwright API tests for the grouped all-events list endpoint on
 * EventDatesController.
 *
 * Exercises GET /fair-events/v1/event-dates/all against a live WordPress
 * instance (#1202): generated series dates are nested under their master
 * instead of appearing as independent top-level rows.
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

test.describe('EventDatesController — grouped all-events list', () => {
	let api;
	let seriesTitle;
	let masterEventDateId;
	let generatedIds;
	let singleEventDateId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		seriesTitle = `Nesting series test ${Date.now()}`;
		const masterRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: seriesTitle,
					start_datetime: '2037-02-01 10:00:00',
					end_datetime: '2037-02-01 12:00:00',
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect(masterRes.ok()).toBeTruthy();
		const masterBody = await masterRes.json();
		masterEventDateId = masterBody.id;
		generatedIds = masterBody.generated_occurrences.map((o) => o.id);
		expect(generatedIds.length).toBe(2);

		const singleRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Nesting single test ${Date.now()}`,
					start_datetime: '2037-03-01 10:00:00',
				},
			}
		);
		expect(singleRes.ok()).toBeTruthy();
		singleEventDateId = (await singleRes.json()).id;
	});

	test.afterAll(async () => {
		if (masterEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
				{ headers: adminHeaders }
			);
		}
		if (singleEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${singleEventDateId}`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	});

	test('generated occurrences are absent from the top level, master carries children ordered by date ascending', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/event-dates/all?per_page=100',
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		const ids = body.map((item) => item.id);
		generatedIds.forEach((id) => expect(ids).not.toContain(id));
		expect(ids).toContain(masterEventDateId);
		expect(ids).toContain(singleEventDateId);

		const master = body.find((item) => item.id === masterEventDateId);
		expect(master.occurrence_type).toBe('master');
		expect(master.children_count).toBe(2);
		expect(master.children.map((c) => c.id)).toEqual(generatedIds);
		expect(
			new Date(master.children[0].start_datetime).getTime()
		).toBeLessThan(new Date(master.children[1].start_datetime).getTime());
	});

	test('X-WP-Total counts top-level rows only', async () => {
		const resFiltered = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?search=${encodeURIComponent(
				seriesTitle
			)}`,
			{ headers: adminHeaders }
		);
		expect(resFiltered.ok()).toBeTruthy();
		const bodyFiltered = await resFiltered.json();
		const totalFiltered = parseInt(
			resFiltered.headers()['x-wp-total'] || '0',
			10
		);

		// Only the master matches the search title at the top level; its
		// generated children (which share no title of their own) don't add
		// to the count.
		expect(totalFiltered).toBe(1);
		expect(bodyFiltered.length).toBe(1);
		expect(bodyFiltered[0].id).toBe(masterEventDateId);
	});

	test('occurrence_type=generated filter still returns a flat list', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/event-dates/all?occurrence_type=generated&per_page=100',
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		const ids = body.map((item) => item.id);
		generatedIds.forEach((id) => expect(ids).toContain(id));
		body.forEach((item) => {
			expect(item.occurrence_type).toBe('generated');
			expect(item.children).toBeUndefined();
		});
	});

	test('search matches masters', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?search=${encodeURIComponent(
				seriesTitle
			)}`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		expect(body.length).toBe(1);
		expect(body[0].id).toBe(masterEventDateId);
		expect(body[0].occurrence_type).toBe('master');
	});
});
