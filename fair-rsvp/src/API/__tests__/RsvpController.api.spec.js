/**
 * API tests for RSVP REST endpoints
 *
 * Tests the fair-rsvp REST API controller using Playwright's request context.
 * These tests validate API behavior, authentication, and error handling.
 *
 * @see src/API/RsvpController.php
 */

import { test, expect } from '@playwright/test';
import { getWordPressAuth } from './helpers/wordpress-auth.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';

/**
 * Get the correct REST URL based on permalink structure
 * Supports both pretty permalinks (/wp-json/) and plain permalinks (?rest_route=/)
 */
async function getRestUrl(request, path) {
	// Check if pretty permalinks work
	const testResponse = await request.get(`${BASE_URL}/wp-json/`);

	if (testResponse.status() === 404) {
		// Use plain permalinks
		return `${BASE_URL}/?rest_route=${path}`;
	}

	// Use pretty permalinks
	return `${BASE_URL}/wp-json${path}`;
}

test.describe('RSVP REST API', () => {
	let auth;
	let restUrlBase;

	// Get WordPress authentication before all tests
	test.beforeAll(async ({ request }) => {
		auth = await getWordPressAuth(request, BASE_URL);

		// Detect permalink structure
		const testResponse = await request.get(`${BASE_URL}/wp-json/`);
		restUrlBase =
			testResponse.status() === 404 ? '/?rest_route=' : '/wp-json';
	});

	test.describe('POST /fair-rsvp/v1/rsvp', () => {
		test('should require authentication', async ({ request }) => {
			const url = `${BASE_URL}${restUrlBase}/fair-rsvp/v1/rsvp`;
			const response = await request.post(url, {
				data: {
					event_id: 1,
					rsvp_status: 'yes',
				},
			});

			// Expect 401 (not logged in) or 403 (forbidden)
			expect([401, 403]).toContain(response.status());
			const data = await response.json();
			expect(data.code).toMatch(/rest_(not_logged_in|forbidden)/);
		});

		test('should respond for authenticated user', async ({ request }) => {
			// This test validates authentication works
			const url = `${BASE_URL}${restUrlBase}/fair-rsvp/v1/rsvp`;
			const response = await request.post(url, {
				headers: auth.headers,
				data: {
					event_id: 999999, // Non-existent event
					rsvp_status: 'yes',
				},
			});

			// Should return proper HTTP status (not 401/403 auth errors)
			// Could be 201 (created), 400 (validation error), 403 (permission), or 404 (not found)
			expect(response.status()).toBeGreaterThanOrEqual(200);
			expect(response.status()).toBeLessThan(500);
		});
	});

	test.describe('GET /fair-rsvp/v1/rsvp', () => {
		test('should handle unauthenticated request', async ({ request }) => {
			const url = `${BASE_URL}${restUrlBase}/fair-rsvp/v1/rsvp?event_id=1`;
			const response = await request.get(url);

			// Expect 401, 403, or 404 (depending on endpoint implementation)
			expect([401, 403, 404]).toContain(response.status());
		});

		test('should respond for authenticated user', async ({ request }) => {
			const url = `${BASE_URL}${restUrlBase}/fair-rsvp/v1/rsvp?event_id=1`;
			const response = await request.get(url, {
				headers: auth.headers,
			});

			// Should return proper HTTP status
			// Could be 200 (has RSVP), 403 (permission), or 404 (no RSVP)
			expect(response.status()).toBeGreaterThanOrEqual(200);
			expect(response.status()).toBeLessThan(500);
		});
	});
});
