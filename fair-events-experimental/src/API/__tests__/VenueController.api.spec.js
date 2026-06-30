/**
 * Playwright API tests for VenueController.
 *
 * Verifies that the venues endpoint returns `maps_url` (computed) and does not
 * expose the removed `google_maps_link` field.
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

test.describe('VenueController', () => {
	let api;
	let venueId;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		if (venueId) {
			await api.delete(`/wp-json/fair-events/v1/venues/${venueId}`, {
				headers: authHeader,
			});
		}
		await api.dispose();
	});

	test('creates a venue with coordinates and returns maps_url pointing to lat/lng', async () => {
		const res = await api.post('/wp-json/fair-events/v1/venues', {
			headers: authHeader,
			data: {
				name: `API Test Venue ${Date.now()}`,
				address: 'Gran Via 1, Valencia',
				latitude: '39.4878023',
				longitude: '-0.3613204',
			},
		});

		expect(res.ok()).toBeTruthy();
		const body = await res.json();
		venueId = body.id;

		expect(body).not.toHaveProperty('google_maps_link');
		expect(body).toHaveProperty('maps_url');
		expect(body.maps_url).toContain('39.4878023');
		expect(body.maps_url).toContain('-0.3613204');
	});

	test('creates a venue with address only and returns maps_url from address', async () => {
		const res = await api.post('/wp-json/fair-events/v1/venues', {
			headers: authHeader,
			data: {
				name: `API Test Venue Address ${Date.now()}`,
				address: 'Calle Mayor 10, Madrid',
			},
		});

		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		// Clean up immediately.
		await api.delete(`/wp-json/fair-events/v1/venues/${body.id}`, {
			headers: authHeader,
		});

		expect(body).not.toHaveProperty('google_maps_link');
		expect(body).toHaveProperty('maps_url');
		expect(body.maps_url).not.toBeNull();
		expect(body.maps_url).toContain('Calle');
	});

	test('creates a venue with no location and returns null maps_url', async () => {
		const res = await api.post('/wp-json/fair-events/v1/venues', {
			headers: authHeader,
			data: {
				name: `API Test Venue No Location ${Date.now()}`,
			},
		});

		expect(res.ok()).toBeTruthy();
		const body = await res.json();

		// Clean up immediately.
		await api.delete(`/wp-json/fair-events/v1/venues/${body.id}`, {
			headers: authHeader,
		});

		expect(body).not.toHaveProperty('google_maps_link');
		expect(body.maps_url).toBeNull();
	});
});
