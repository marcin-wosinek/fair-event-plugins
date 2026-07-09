/**
 * Playwright API tests for the participant audience-stats endpoint (#1054):
 * GET /fair-audience/v1/participants/stats.
 *
 * Exact mailing/pending totals depend on DB state shared across the test
 * suite, so this asserts relative correctness (seeding participants
 * increases `total` by the expected amount) rather than absolute counts,
 * mirroring ParticipantsActivityTransactionStatus.api.spec.js.
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

test.describe('ParticipantsController — GET /participants/stats', () => {
	let api;
	const participantIds = [];

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		for (const id of participantIds) {
			await api.delete(`/wp-json/fair-audience/v1/participants/${id}`, {
				headers: authHeaders,
			});
		}
		await api.dispose();
	});

	test('unauthenticated request is rejected', async () => {
		const res = await api.get(
			'/wp-json/fair-audience/v1/participants/stats'
		);
		expect(res.status()).toBe(401);
	});

	test('authenticated request returns total/mailing/pending/declined counts', async () => {
		const before = await api.get(
			'/wp-json/fair-audience/v1/participants/stats',
			{ headers: authHeaders }
		);
		expect(before.ok()).toBeTruthy();
		const beforeBody = await before.json();
		expect(beforeBody).toEqual(
			expect.objectContaining({
				total: expect.any(Number),
				mailing: expect.any(Number),
				pending: expect.any(Number),
				declined: expect.any(Number),
			})
		);

		const createRes = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: authHeaders,
				data: {
					name: 'Stats Tester',
					email: uniqueEmail('stats-tester'),
				},
			}
		);
		expect(createRes.ok()).toBeTruthy();
		participantIds.push((await createRes.json()).id);

		const after = await api.get(
			'/wp-json/fair-audience/v1/participants/stats',
			{ headers: authHeaders }
		);
		expect(after.ok()).toBeTruthy();
		const afterBody = await after.json();
		expect(afterBody.total).toBe(beforeBody.total + 1);
	});
});
