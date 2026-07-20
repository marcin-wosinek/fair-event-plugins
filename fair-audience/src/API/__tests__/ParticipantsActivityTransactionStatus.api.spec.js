/**
 * Playwright API tests for transaction status on the participant activity
 * endpoint (issue #984): GET /fair-audience/v1/participants/{id}/activity.
 *
 * Each event entry now carries a `transaction_status` derived from the
 * matching fair-payments-connector transaction ('success' | 'pending' |
 * 'failed' | null). Since #1113, both `transaction_id` and `transaction_status`
 * are sourced from the event-participant transaction ledger (the latest
 * charge per registration) rather than the removed
 * event_participants.transaction_id column. Seeding a real paid/pending/failed
 * transaction requires routing a signup through the Mollie flow, so —
 * mirroring TimelineController.api.spec.js — this suite covers the shape
 * contract that is reachable over HTTP: a free (no-transaction) signup must
 * report transaction_id/transaction_status as null. The paid/pending/failed
 * status mapping itself is exercised via the WP-CLI eval-file manual check
 * (TESTING.md).
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

test.describe('ParticipantsController activity — transaction_status', () => {
	let api;
	let participantId;
	let eventId;
	let eventDateId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		const partRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Transaction Status Tester',
					email: uniqueEmail('transaction-status'),
				},
			}
		);
		expect(partRes.ok()).toBeTruthy();
		participantId = (await partRes.json()).id;

		const eventRes = await api.post('/wp-json/wp/v2/fair_event', {
			headers: authHeaders,
			data: {
				title: `Transaction Status Event ${Date.now()}`,
				status: 'publish',
			},
		});
		expect(eventRes.ok()).toBeTruthy();
		eventId = (await eventRes.json()).id;

		const eventsRes = await api.get('/wp-json/fair-audience/v1/events', {
			headers: authHeaders,
			params: { per_page: 100 },
		});
		expect(eventsRes.ok()).toBeTruthy();
		const match = (await eventsRes.json()).find(
			(e) => e.event_id === eventId
		);
		expect(match, 'event-date row for the test event').toBeTruthy();
		eventDateId = match.event_date_id;

		const linkRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${eventDateId}/participants`,
			{
				headers: authHeaders,
				data: { participant_id: participantId, label: 'signed_up' },
			}
		);
		expect(linkRes.ok()).toBeTruthy();
	});

	test.afterAll(async () => {
		if (participantId) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${participantId}`,
				{ headers: authHeaders }
			);
		}
		if (eventId) {
			await api.delete(`/wp-json/wp/v2/fair_event/${eventId}`, {
				headers: authHeaders,
				params: { force: 'true' },
			});
		}
		await api.dispose();
	});

	test('unauthenticated request is rejected', async () => {
		const res = await api.get(
			`/wp-json/fair-audience/v1/participants/${participantId}/activity`
		);
		expect(res.status()).toBe(401);
	});

	test('a signup with no transaction reports null transaction_status', async () => {
		const res = await api.get(
			`/wp-json/fair-audience/v1/participants/${participantId}/activity`,
			{ headers: authHeaders }
		);
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		expect(Array.isArray(body.events)).toBe(true);

		const event = body.events.find((ev) => ev.event_id === eventId);
		expect(event, 'linked event in the activity response').toBeTruthy();
		expect(event.transaction_id).toBeNull();
		expect(event.transaction_status).toBeNull();
	});
});
