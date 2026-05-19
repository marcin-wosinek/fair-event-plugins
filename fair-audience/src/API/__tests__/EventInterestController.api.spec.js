/**
 * Playwright API tests for the EventInterestController.
 *
 * Exercises POST and DELETE /fair-audience/v1/event-interest against a live
 * WordPress instance. The test event is created via the WP REST API using
 * admin Application Password credentials (WP_ADMIN_USER / WP_ADMIN_PASSWORD
 * env vars) and torn down at the end of the suite.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminAuth = {
	username: ADMIN_USER,
	password: ADMIN_PASSWORD,
};

function uniqueEmail(prefix) {
	return `${prefix}+${Date.now()}-${Math.floor(
		Math.random() * 1e6
	)}@example.test`;
}

test.describe('EventInterestController', () => {
	let api;
	let eventId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });

		// Create a draft event post to act as our test event. The event-dates
		// row is created by fair-events lifecycle hooks on publish.
		const res = await api.post('/wp-json/wp/v2/fair_event', {
			headers: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
			data: {
				title: `Event Interest Test ${Date.now()}`,
				status: 'publish',
			},
		});
		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		eventId = body.id;
	});

	test.afterAll(async () => {
		if (eventId) {
			await api.delete(`/wp-json/wp/v2/fair_event/${eventId}`, {
				headers: {
					Authorization:
						'Basic ' +
						Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
							'base64'
						),
				},
				params: { force: 'true' },
			});
		}
		await api.dispose();
	});

	test('POST creates a new interest registration', async () => {
		const res = await api.post('/wp-json/fair-audience/v1/event-interest', {
			data: {
				event_id: eventId,
				email: uniqueEmail('new'),
				name: 'New User',
			},
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
	});

	test('POST a second time with the same email is a no-op success', async () => {
		const email = uniqueEmail('dup');
		const first = await api.post(
			'/wp-json/fair-audience/v1/event-interest',
			{ data: { event_id: eventId, email } }
		);
		expect(first.ok()).toBeTruthy();

		const second = await api.post(
			'/wp-json/fair-audience/v1/event-interest',
			{ data: { event_id: eventId, email } }
		);
		expect(second.ok()).toBeTruthy();
		const body = await second.json();
		expect(body.success).toBe(true);
	});

	test('POST with honeypot filled is silently accepted without writes', async () => {
		const res = await api.post('/wp-json/fair-audience/v1/event-interest', {
			data: {
				event_id: eventId,
				email: uniqueEmail('bot'),
				honeypot: 'http://spammy.example/',
			},
		});
		expect(res.status()).toBe(200);
		const body = await res.json();
		expect(body.success).toBe(true);
	});

	test('POST with invalid email is rejected with 400', async () => {
		const res = await api.post('/wp-json/fair-audience/v1/event-interest', {
			data: {
				event_id: eventId,
				email: 'not-an-email',
			},
		});
		expect(res.status()).toBe(400);
	});

	test('POST with missing event_id returns an error', async () => {
		const res = await api.post('/wp-json/fair-audience/v1/event-interest', {
			data: { email: uniqueEmail('noevent') },
		});
		expect(res.status()).toBeGreaterThanOrEqual(400);
	});

	test('DELETE with invalid token returns 400', async () => {
		const res = await api.delete(
			'/wp-json/fair-audience/v1/event-interest',
			{ params: { token: 'not-a-valid-token' } }
		);
		expect(res.status()).toBe(400);
	});

	test('DELETE with a well-formed but unsigned token returns 400', async () => {
		// base64('999:1:badsig') — passes the shape check, fails the HMAC.
		const fake = Buffer.from('999:1:badsig').toString('base64url');
		const res = await api.delete(
			'/wp-json/fair-audience/v1/event-interest',
			{ params: { token: fake } }
		);
		expect(res.status()).toBe(400);
	});
});
