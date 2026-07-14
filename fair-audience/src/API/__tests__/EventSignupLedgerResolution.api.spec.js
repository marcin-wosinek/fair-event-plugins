/**
 * Playwright API tests for the transaction-ledger webhook resolution fix
 * (#1112): payment webhooks now resolve which registration(s) a transaction
 * belongs to via the fair_audience_event_participant_transactions ledger
 * (populated at transaction-creation time) instead of the mutable
 * event_participants.transaction_id column, which a retry/upgrade attempt
 * can re-point away from an in-flight payment.
 *
 * Reproducing the full incident (create tx A, retry to tx B re-pointing the
 * row, pay tx A, assert the row flips to signed_up and the ledger contains
 * A) needs a real Mollie payment to reach PaymentHooks::handle_signup_paid()
 * — the dev stack has no Mollie double for API-spec tests (only e2e does,
 * per TESTING.md). That end-to-end scenario, including calling
 * PaymentHooks::handle_signup_paid()/handle_signup_failed() directly against
 * seeded transactions, was verified via the WP-CLI eval-file manual check
 * (TESTING.md) alongside this change.
 *
 * This suite covers what is reachable over HTTP without Mollie: the
 * retry-payment endpoint's permission boundary, mirroring the pattern in
 * EventSignupResume.api.spec.js.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ENDPOINT = '/wp-json/fair-audience/v1/event-signup/retry-payment';

test.describe('EventSignupController retry-payment — permission boundary', () => {
	let api;

	test.beforeAll(async () => {
		api = await request.newContext({ baseURL: BASE_URL });
	});

	test.afterAll(async () => {
		await api.dispose();
	});

	test('rejects a missing transaction_id', async () => {
		const res = await api.post(ENDPOINT, { data: {} });
		expect(res.status()).toBe(400);
	});

	test('rejects an invalid transaction_id with 400', async () => {
		const res = await api.post(ENDPOINT, { data: { transaction_id: 0 } });
		expect(res.status()).toBe(400);
		const body = await res.json();
		expect(body.code).toBe('invalid_transaction');
	});

	test('an unknown transaction_id 404s', async () => {
		const res = await api.post(ENDPOINT, {
			data: {
				transaction_id: 999999999,
				signature: 'not-a-real-signature',
			},
		});
		expect(res.status()).toBe(404);
		const body = await res.json();
		expect(body.code).toBe('transaction_not_found');
	});
});
