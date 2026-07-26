/**
 * Playwright API tests for the `fair_events_organizer` setting exposed
 * through core's /wp/v2/settings endpoint.
 *
 * Verifies the write -> read-back round trip is sanitized (malformed
 * same_as entries dropped) and that the setting is gated on manage_options.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const authHeader = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('fair_events_organizer setting', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		// Reset to empty so later suites see the fallback organizer.
		await api.post('/wp-json/wp/v2/settings', {
			headers: authHeader,
			data: { fair_events_organizer: {} },
		});
		await api.dispose();
	});

	test('writes then reads back a sanitized organizer identity', async () => {
		const res = await api.post('/wp-json/wp/v2/settings', {
			headers: authHeader,
			data: {
				fair_events_organizer: {
					name: 'Acme Club',
					type: 'SportsClub',
					street_address: 'Main St 1',
					address_locality: 'Madrid',
					address_country: 'ES',
					same_as: ['https://example.com/acme', 'not a valid url'],
				},
			},
		});

		expect(res.status()).toBe(200);
		const body = await res.json();

		expect(body.fair_events_organizer.name).toBe('Acme Club');
		expect(body.fair_events_organizer.type).toBe('SportsClub');
		expect(body.fair_events_organizer.same_as).toEqual([
			'https://example.com/acme',
		]);

		const read = await api.get('/wp-json/wp/v2/settings', {
			headers: authHeader,
		});
		const readBody = await read.json();
		expect(readBody.fair_events_organizer.name).toBe('Acme Club');
		expect(readBody.fair_events_organizer.same_as).toEqual([
			'https://example.com/acme',
		]);
	});

	test('rejects an unauthenticated write', async () => {
		const anonymousApi = await request.newContext({ baseURL: BASE_URL });
		const res = await anonymousApi.post('/wp-json/wp/v2/settings', {
			data: { fair_events_organizer: { name: 'Should Not Save' } },
		});

		expect(res.status()).toBe(401);
		await anonymousApi.dispose();
	});
});
