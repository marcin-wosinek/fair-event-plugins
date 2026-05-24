/**
 * Playwright API tests for the ScheduledMessagesController.
 *
 * Exercises the scheduled per-event-date mailing endpoints against a live
 * WordPress instance:
 *   GET/POST  /fair-audience/v1/event-dates/{event_date_id}/scheduled-messages
 *   POST      /fair-audience/v1/event-dates/{event_date_id}/scheduled-messages/preview-recipients
 *   PUT/DELETE /fair-audience/v1/scheduled-messages/{id}
 *   POST      /fair-audience/v1/scheduled-messages/{id}/preview-recipients
 *
 * Fixtures (event, event-date, participants, links) are created via the admin
 * REST API using Application Password credentials (WP_ADMIN_USER /
 * WP_ADMIN_PASSWORD) and torn down at the end of the suite.
 *
 * Out of HTTP scope (validated by design / manually): the 5-minute cron tick
 * (claim-and-send idempotency) and reschedule-on-event-date-move, which require
 * triggering WP-Cron and editing event-date times outside this controller.
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

async function createParticipant(api, { name, email, email_profile }) {
	const res = await api.post('/wp-json/fair-audience/v1/participants', {
		headers: authHeaders,
		data: { name, email, email_profile },
	});
	expect(res.ok()).toBeTruthy();
	return (await res.json()).id;
}

async function publishEvent(api, title) {
	const res = await api.post('/wp-json/wp/v2/fair_event', {
		headers: authHeaders,
		data: { title, status: 'publish' },
	});
	expect(res.ok()).toBeTruthy();
	return (await res.json()).id;
}

async function resolveEventDateId(api, eventId) {
	const res = await api.get('/wp-json/fair-audience/v1/events', {
		headers: authHeaders,
		params: { per_page: 100 },
	});
	expect(res.ok()).toBeTruthy();
	const events = await res.json();
	const match = events.find((e) => e.event_id === eventId);
	expect(match, 'event-date row for the test event').toBeTruthy();
	return match.event_date_id;
}

async function deleteEvent(api, eventId) {
	await api.delete(`/wp-json/wp/v2/fair_event/${eventId}`, {
		headers: authHeaders,
		params: { force: 'true' },
	});
}

const baseMessage = (anchorRefId, overrides = {}) => ({
	subject: 'Reminder',
	body: 'Hi {participant_name}, see you at {event_name} on {event_date}. {unsubscribe_link}',
	anchor_type: 'event_date_start',
	anchor_ref_id: anchorRefId,
	offset_minutes: -60,
	recipients_filter: {
		labels: ['signed_up'],
		group_ids: [],
		is_marketing: false,
	},
	...overrides,
});

test.describe('ScheduledMessagesController', () => {
	let api;
	let eventId;
	let eventDateId;
	let signedUpId;
	let interestedId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		eventId = await publishEvent(api, `Scheduled Mail Test ${Date.now()}`);
		eventDateId = await resolveEventDateId(api, eventId);

		signedUpId = await createParticipant(api, {
			name: 'Signed Up',
			email: uniqueEmail('signed'),
			email_profile: 'marketing',
		});
		interestedId = await createParticipant(api, {
			name: 'Interested',
			email: uniqueEmail('interested'),
			email_profile: 'marketing',
		});

		// Link with distinct labels so recipient filtering is observable.
		const linkSigned = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/batch`,
			{
				headers: authHeaders,
				data: { participant_ids: [signedUpId], label: 'signed_up' },
			}
		);
		expect(linkSigned.ok()).toBeTruthy();

		const linkInterested = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants/batch`,
			{
				headers: authHeaders,
				data: { participant_ids: [interestedId], label: 'interested' },
			}
		);
		expect(linkInterested.ok()).toBeTruthy();
	});

	test.afterAll(async () => {
		for (const id of [signedUpId, interestedId]) {
			if (id) {
				await api.delete(
					`/wp-json/fair-audience/v1/participants/${id}`,
					{ headers: authHeaders }
				);
			}
		}
		if (eventId) {
			await deleteEvent(api, eventId);
		}
		await api.dispose();
	});

	test('unauthenticated create is rejected', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/scheduled-messages`,
			{ data: baseMessage(eventDateId) }
		);
		expect(res.status()).toBeGreaterThanOrEqual(401);
		expect(res.status()).toBeLessThan(404);
	});

	test('create schedules a message with a computed send time', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/scheduled-messages`,
			{ headers: authHeaders, data: baseMessage(eventDateId) }
		);
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.id).toBeGreaterThan(0);
		expect(body.status).toBe('scheduled');
		expect(body.event_date_id).toBe(eventDateId);
		expect(body.scheduled_for).toBeTruthy();
		expect(body.recipients_filter.labels).toEqual(['signed_up']);

		// Clean up this row so other tests start from a known state.
		await api.delete(
			`/wp-json/fair-audience/v1/scheduled-messages/${body.id}`,
			{ headers: authHeaders }
		);
	});

	test('sale-period anchors are rejected until #617', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/scheduled-messages`,
			{
				headers: authHeaders,
				data: baseMessage(eventDateId, {
					anchor_type: 'sale_period_start',
				}),
			}
		);
		expect(res.status()).toBe(400);
	});

	test('create on a nonexistent event date is rejected', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/999999999/scheduled-messages`,
			{ headers: authHeaders, data: baseMessage(999999999) }
		);
		expect(res.status()).toBe(404);
	});

	test('list, edit, preview, and cancel lifecycle', async () => {
		// Create.
		const createRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/scheduled-messages`,
			{ headers: authHeaders, data: baseMessage(eventDateId) }
		);
		expect(createRes.ok()).toBeTruthy();
		const created = await createRes.json();
		const originalSchedule = created.scheduled_for;

		// List includes it.
		const listRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/scheduled-messages`,
			{ headers: authHeaders }
		);
		expect(listRes.ok()).toBeTruthy();
		const list = await listRes.json();
		expect(list.some((m) => m.id === created.id)).toBe(true);

		// Preview recipients (stored filter) resolves only the signed_up one.
		const previewRes = await api.post(
			`/wp-json/fair-audience/v1/scheduled-messages/${created.id}/preview-recipients`,
			{ headers: authHeaders }
		);
		expect(previewRes.ok()).toBeTruthy();
		const recipients = await previewRes.json();
		const ids = recipients.map((r) => r.participant_id);
		expect(ids).toContain(signedUpId);
		expect(ids).not.toContain(interestedId);

		// Edit: a larger negative offset moves the send time earlier.
		const editRes = await api.put(
			`/wp-json/fair-audience/v1/scheduled-messages/${created.id}`,
			{
				headers: authHeaders,
				data: baseMessage(eventDateId, {
					subject: 'Updated subject',
					offset_minutes: -180,
				}),
			}
		);
		expect(editRes.ok()).toBeTruthy();
		const edited = await editRes.json();
		expect(edited.subject).toBe('Updated subject');
		expect(edited.offset_minutes).toBe(-180);
		expect(new Date(edited.scheduled_for).getTime()).toBeLessThan(
			new Date(originalSchedule).getTime()
		);

		// Cancel.
		const cancelRes = await api.delete(
			`/wp-json/fair-audience/v1/scheduled-messages/${created.id}`,
			{ headers: authHeaders }
		);
		expect(cancelRes.ok()).toBeTruthy();
		expect((await cancelRes.json()).status).toBe('canceled');

		// Editing a canceled message is a conflict.
		const reEdit = await api.put(
			`/wp-json/fair-audience/v1/scheduled-messages/${created.id}`,
			{ headers: authHeaders, data: baseMessage(eventDateId) }
		);
		expect(reEdit.status()).toBe(409);

		// Canceling again is a conflict.
		const reCancel = await api.delete(
			`/wp-json/fair-audience/v1/scheduled-messages/${created.id}`,
			{ headers: authHeaders }
		);
		expect(reCancel.status()).toBe(409);
	});

	test('draft preview honors label filters without saving', async () => {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/scheduled-messages/preview-recipients`,
			{
				headers: authHeaders,
				data: {
					recipients_filter: {
						labels: ['interested'],
						group_ids: [],
						is_marketing: false,
					},
				},
			}
		);
		expect(res.ok()).toBeTruthy();
		const recipients = await res.json();
		const ids = recipients.map((r) => r.participant_id);
		expect(ids).toContain(interestedId);
		expect(ids).not.toContain(signedUpId);
	});

	test('deleting the event date cancels its scheduled messages', async () => {
		const tempEventId = await publishEvent(api, `Temp Event ${Date.now()}`);
		const tempDateId = await resolveEventDateId(api, tempEventId);

		const createRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${tempDateId}/scheduled-messages`,
			{ headers: authHeaders, data: baseMessage(tempDateId) }
		);
		expect(createRes.ok()).toBeTruthy();
		const messageId = (await createRes.json()).id;

		// Delete the event date; fair_events_event_date_deleted cascades the
		// cancel onto its anchored mailings.
		const delRes = await api.delete(
			`/wp-json/fair-events/v1/event-dates/${tempDateId}`,
			{ headers: authHeaders }
		);
		expect(delRes.ok()).toBeTruthy();

		// The message row survives the date deletion but is now canceled.
		const listRes = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${tempDateId}/scheduled-messages`,
			{ headers: authHeaders }
		);
		expect(listRes.ok()).toBeTruthy();
		const list = await listRes.json();
		const message = list.find((m) => m.id === messageId);
		expect(
			message,
			'scheduled message row survives event-date deletion'
		).toBeTruthy();
		expect(message.status).toBe('canceled');

		await deleteEvent(api, tempEventId);
	});
});
