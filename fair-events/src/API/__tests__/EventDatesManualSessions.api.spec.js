/**
 * Playwright API tests for multiple sessions per day in an irregular
 * (manual) series (#1414).
 *
 * Covers:
 * - Creating a manual series with two sessions on the same calendar date —
 *   both persist as distinct rows instead of being rejected/collapsed.
 * - Editing one session's time by id preserves that session's id (and, by
 *   extension, anything attached to it) without touching its same-day
 *   sibling.
 * - Removing one of two same-day sessions soft-cancels it (id survives,
 *   status flips to 'cancelled') and leaves the sibling active and
 *   untouched.
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

test.describe('EventDatesController — manual series with multiple sessions per day', () => {
	let api;
	let eventDateId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		if (eventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	});

	test('creating a manual series with two sessions on the same date persists both', async () => {
		const res = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Multi-session day test ${Date.now()}`,
				start_datetime: '2030-06-01 09:00:00',
				end_datetime: '2030-06-01 11:00:00',
				recurrence_mode: 'manual',
				manual_sessions: [
					{
						id: null,
						start_datetime: '2030-06-01 09:00:00',
						end_datetime: '2030-06-01 11:00:00',
					},
					{
						id: null,
						start_datetime: '2030-06-01 14:00:00',
						end_datetime: '2030-06-01 16:00:00',
					},
				],
			},
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		eventDateId = body.id;

		expect(body.recurrence_mode).toBe('manual');
		expect(body.occurrence_type).toBe('master');
		// The earliest session (09:00) becomes the master row.
		expect(body.start_datetime).toBe('2030-06-01 09:00:00');

		// The other same-day session persists as its own generated child —
		// not rejected/collapsed as a duplicate date.
		expect(body.generated_occurrences).toHaveLength(1);
		const child = body.generated_occurrences[0];
		expect(child.start_datetime).toBe('2030-06-01 14:00:00');
		expect(child.end_datetime).toBe('2030-06-01 16:00:00');
		expect(child.status).toBe('active');
	});

	test("editing one session's time by id preserves its id and leaves its same-day sibling untouched", async () => {
		const before = await api.get(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
			{ headers: adminHeaders }
		);
		const beforeBody = await before.json();
		const childId = beforeBody.generated_occurrences[0].id;

		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
			{
				headers: adminHeaders,
				data: {
					recurrence_mode: 'manual',
					manual_sessions: [
						{
							id: eventDateId,
							start_datetime: '2030-06-01 09:00:00',
							end_datetime: '2030-06-01 11:00:00',
						},
						{
							id: childId,
							start_datetime: '2030-06-01 15:30:00',
							end_datetime: '2030-06-01 17:30:00',
						},
					],
				},
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		expect(body.generated_occurrences).toHaveLength(1);
		const child = body.generated_occurrences[0];
		// Same id — the row was updated in place, not replaced.
		expect(child.id).toBe(childId);
		expect(child.start_datetime).toBe('2030-06-01 15:30:00');
		expect(child.end_datetime).toBe('2030-06-01 17:30:00');
		// The master's own session is untouched by the sibling's edit.
		expect(body.start_datetime).toBe('2030-06-01 09:00:00');
	});

	test('removing one of several same-day sessions soft-cancels it and leaves the others active', async () => {
		// The previous test left one child (15:30) on the master's date —
		// grow to two children by referencing that existing id alongside a
		// brand-new session, so removing one still leaves the master a
		// genuine (not collapsed-to-single) series — collapsing to a single
		// occurrence is set_manual_sessions()'s own documented behavior when
		// only the master remains, so it's tested separately rather than
		// conflated with the soft-cancel path here.
		const before = await api.get(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
			{ headers: adminHeaders }
		);
		const beforeBody = await before.json();
		const survivorId = beforeBody.generated_occurrences[0].id;

		const seedRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
			{
				headers: adminHeaders,
				data: {
					recurrence_mode: 'manual',
					manual_sessions: [
						{
							id: eventDateId,
							start_datetime: '2030-06-01 09:00:00',
							end_datetime: '2030-06-01 11:00:00',
						},
						{
							id: survivorId,
							start_datetime: '2030-06-01 15:30:00',
							end_datetime: '2030-06-01 17:30:00',
						},
						{
							id: null,
							start_datetime: '2030-06-01 13:00:00',
							end_datetime: '2030-06-01 14:00:00',
						},
					],
				},
			}
		);
		expect(seedRes.ok()).toBeTruthy();
		const seedBody = await seedRes.json();
		expect(seedBody.generated_occurrences).toHaveLength(2);
		const keptId = seedBody.generated_occurrences.find(
			(occ) => occ.id !== survivorId
		).id;

		// Save again dropping the 15:30 session only — it should be
		// soft-cancelled while the 13:00 sibling stays active.
		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${eventDateId}`,
			{
				headers: adminHeaders,
				data: {
					recurrence_mode: 'manual',
					manual_sessions: [
						{
							id: eventDateId,
							start_datetime: '2030-06-01 09:00:00',
							end_datetime: '2030-06-01 11:00:00',
						},
						{
							id: keptId,
							start_datetime: '2030-06-01 13:00:00',
							end_datetime: '2030-06-01 14:00:00',
						},
					],
				},
			}
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		expect(body.generated_occurrences).toHaveLength(2);
		const kept = body.generated_occurrences.find(
			(occ) => occ.id === keptId
		);
		const cancelled = body.generated_occurrences.find(
			(occ) => occ.id === survivorId
		);
		expect(kept.status).toBe('active');
		// Id and start/end survive — soft-cancelled, not deleted.
		expect(cancelled.status).toBe('cancelled');
		expect(cancelled.start_datetime).toBe('2030-06-01 15:30:00');
	});

	test('a client-supplied session id belonging to another series is rejected', async () => {
		// Self-contained (its own master + own "foreign" id) rather than
		// reusing the outer `eventDateId`, so this test's outcome never
		// depends on state left behind by the tests above it.
		const ownRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Ownership check master ${Date.now()}`,
				start_datetime: '2030-08-01 09:00:00',
				end_datetime: '2030-08-01 11:00:00',
			},
		});
		expect(ownRes.ok()).toBeTruthy();
		const ownId = (await ownRes.json()).id;

		const otherRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Unrelated series ${Date.now()}`,
				start_datetime: '2030-07-01 09:00:00',
				end_datetime: '2030-07-01 11:00:00',
			},
		});
		expect(otherRes.ok()).toBeTruthy();
		const otherId = (await otherRes.json()).id;

		try {
			const res = await api.put(
				`/wp-json/fair-events/v1/event-dates/${ownId}`,
				{
					headers: adminHeaders,
					data: {
						recurrence_mode: 'manual',
						manual_sessions: [
							{
								id: ownId,
								start_datetime: '2030-08-01 09:00:00',
								end_datetime: '2030-08-01 11:00:00',
							},
							{
								// Belongs to `otherId`'s series, not this one.
								id: otherId,
								start_datetime: '2030-08-02 09:00:00',
								end_datetime: '2030-08-02 11:00:00',
							},
						],
					},
				}
			);
			// WordPress wraps a param validate_callback's WP_Error in a
			// generic 400 rest_invalid_param response — the callback's own
			// status (403) survives underneath, in details.
			expect(res.status()).toBe(400);
			const body = await res.json();
			expect(body.data.details.manual_sessions.data.status).toBe(403);
			expect(body.data.details.manual_sessions.code).toBe(
				'rest_invalid_manual_session_id'
			);
		} finally {
			await api.delete(`/wp-json/fair-events/v1/event-dates/${ownId}`, {
				headers: adminHeaders,
			});
			await api.delete(`/wp-json/fair-events/v1/event-dates/${otherId}`, {
				headers: adminHeaders,
			});
		}
	});
});
