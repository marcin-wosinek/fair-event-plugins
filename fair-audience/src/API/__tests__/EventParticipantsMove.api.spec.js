/**
 * Playwright API tests for the move-to-occurrence endpoint on
 * EventParticipantsController.
 *
 * Exercises POST
 * /fair-audience/v1/event-dates/{event_date_id}/participants/{participant_id}/move
 * against a live WordPress instance.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

function uniqueEmail(prefix) {
	return `${prefix}+${Date.now()}-${Math.floor(
		Math.random() * 1e6
	)}@example.test`;
}

async function createParticipant(api, name) {
	const res = await api.post('/wp-json/fair-audience/v1/participants', {
		headers: authHeaders,
		data: { name, email: uniqueEmail(name.replace(/\s+/g, '-')) },
	});
	expect(res.ok()).toBeTruthy();
	return (await res.json()).id;
}

test.describe('EventParticipantsController — move', () => {
	let api;
	let eventPostId;
	let masterEventDateId;
	let occurrenceIds;
	let otherEventPostId;
	let otherEventDateId;
	let participantAId;
	let participantBId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const postRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: authHeaders,
			data: { title: `Move test ${Date.now()}`, status: 'publish' },
		});
		expect(postRes.ok()).toBeTruthy();
		eventPostId = (await postRes.json()).id;

		const edRes = await api.post('/wp-json/fair-events/v1/event-dates', {
			headers: authHeaders,
			data: {
				event_id: eventPostId,
				start_datetime: '2036-06-01 10:00:00',
				end_datetime: '2036-06-01 12:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		});
		expect(edRes.ok()).toBeTruthy();
		const edBody = await edRes.json();
		masterEventDateId = edBody.id;
		occurrenceIds = [
			masterEventDateId,
			...edBody.generated_occurrences.map((o) => o.id),
		];
		expect(occurrenceIds.length).toBe(3);

		// Unrelated event date, not part of the recurring series above.
		const otherPostRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: authHeaders,
			data: { title: `Unrelated event ${Date.now()}`, status: 'publish' },
		});
		expect(otherPostRes.ok()).toBeTruthy();
		otherEventPostId = (await otherPostRes.json()).id;

		const otherEdRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: authHeaders,
				data: {
					event_id: otherEventPostId,
					start_datetime: '2036-06-15 10:00:00',
					end_datetime: '2036-06-15 12:00:00',
				},
			}
		);
		expect(otherEdRes.ok()).toBeTruthy();
		otherEventDateId = (await otherEdRes.json()).id;

		participantAId = await createParticipant(api, 'Move Person A');
		participantBId = await createParticipant(api, 'Move Person B');
	});

	test.afterAll(async () => {
		for (const id of [participantAId, participantBId]) {
			if (id) {
				await api.delete(
					`/wp-json/fair-audience/v1/participants/${id}`,
					{ headers: authHeaders }
				);
			}
		}
		if (masterEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${masterEventDateId}`,
				{ headers: authHeaders }
			);
		}
		if (otherEventDateId) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${otherEventDateId}`,
				{ headers: authHeaders }
			);
		}
		if (eventPostId) {
			await api.delete(`/wp-json/wp/v2/fair_event/${eventPostId}`, {
				headers: authHeaders,
				params: { force: 'true' },
			});
		}
		if (otherEventPostId) {
			await api.delete(`/wp-json/wp/v2/fair_event/${otherEventPostId}`, {
				headers: authHeaders,
				params: { force: 'true' },
			});
		}
		await api.dispose();
	});

	test('moves a signup to a sibling occurrence, preserving data', async () => {
		const sourceId = occurrenceIds[0];
		const targetId = occurrenceIds[1];

		const addRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${sourceId}/participants`,
			{
				headers: authHeaders,
				data: { participant_id: participantAId, label: 'signed_up' },
			}
		);
		expect(addRes.ok()).toBeTruthy();

		const updateRes = await api.put(
			`/wp-json/fair-audience/v1/event-dates/${sourceId}/participants/${participantAId}`,
			{
				headers: authHeaders,
				data: { attended: true, admin_comment: 'paid in cash' },
			}
		);
		expect(updateRes.ok()).toBeTruthy();
		const updateBody = await updateRes.json();
		expect(updateBody.attended_at).toBeTruthy();

		const moveRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${sourceId}/participants/${participantAId}/move`,
			{
				headers: authHeaders,
				data: { target_event_date_id: targetId },
			}
		);
		expect(moveRes.ok()).toBeTruthy();

		const sourceList = await (
			await api.get(
				`/wp-json/fair-audience/v1/event-dates/${sourceId}/participants`,
				{ headers: authHeaders }
			)
		).json();
		expect(
			sourceList.find((p) => p.participant_id === participantAId)
		).toBeUndefined();

		const targetList = await (
			await api.get(
				`/wp-json/fair-audience/v1/event-dates/${targetId}/participants`,
				{ headers: authHeaders }
			)
		).json();
		const moved = targetList.find(
			(p) => p.participant_id === participantAId
		);
		expect(moved).toBeTruthy();
		expect(moved.label).toBe('signed_up');
		expect(moved.attended_at).toBeTruthy();
		expect(moved.admin_comment).toBe('paid in cash');
	});

	test('moving onto a date where the participant already exists returns 409', async () => {
		const sourceId = occurrenceIds[1];
		const targetId = occurrenceIds[2];

		// Participant A is now on occurrenceIds[1] (target of the previous test).
		const addRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${targetId}/participants`,
			{
				headers: authHeaders,
				data: { participant_id: participantAId, label: 'signed_up' },
			}
		);
		expect(addRes.ok()).toBeTruthy();

		const moveRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${sourceId}/participants/${participantAId}/move`,
			{
				headers: authHeaders,
				data: { target_event_date_id: targetId },
			}
		);
		expect(moveRes.status()).toBe(409);

		// No duplicate: still exactly one row for this participant on the target.
		const targetList = await (
			await api.get(
				`/wp-json/fair-audience/v1/event-dates/${targetId}/participants`,
				{ headers: authHeaders }
			)
		).json();
		expect(
			targetList.filter((p) => p.participant_id === participantAId).length
		).toBe(1);
	});

	test('moving a signup that does not exist on the source returns 404', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${occurrenceIds[0]}/participants/${participantBId}/move`,
			{
				headers: authHeaders,
				data: { target_event_date_id: occurrenceIds[1] },
			}
		);
		expect(res.status()).toBe(404);
	});

	test('moving to a non-sibling event date returns 400', async () => {
		const addRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${occurrenceIds[0]}/participants`,
			{
				headers: authHeaders,
				data: { participant_id: participantBId, label: 'signed_up' },
			}
		);
		expect(addRes.ok()).toBeTruthy();

		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${occurrenceIds[0]}/participants/${participantBId}/move`,
			{
				headers: authHeaders,
				data: { target_event_date_id: otherEventDateId },
			}
		);
		expect(res.status()).toBe(400);
	});

	test('unauthenticated request is rejected', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${occurrenceIds[0]}/participants/${participantBId}/move`,
			{ data: { target_event_date_id: occurrenceIds[1] } }
		);
		expect(res.status()).toBeGreaterThanOrEqual(401);
		expect(res.status()).toBeLessThan(404);
	});
});
