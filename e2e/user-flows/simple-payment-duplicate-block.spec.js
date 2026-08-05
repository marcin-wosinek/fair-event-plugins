/**
 * E2E: fair-payments-connector — a page whose saved content already has two
 * Simple Payment blocks sharing one blockId (as if the editor's
 * duplicate-detection had never run on it, e.g. a pre-fix page or hand-edited
 * markup).
 *
 * Covers the fix for #1325: the endpoint must reject the payment with 409
 * ambiguous_block rather than trusting whichever block it matches first.
 */

import { test, expect } from '@playwright/test';
import { runScript } from '../support/wp-cli.js';

let seed;

test.beforeAll(() => {
	seed = runScript(
		'seed-payment-page-duplicate.php',
		'E2E_PAYMENT_PAGE_DUPLICATE',
		'12.50 45.00'
	);
});

test.afterAll(() => {
	if (seed) {
		runScript(
			'cleanup-payment-page.php',
			'E2E_PAYMENT_CLEANUP',
			String(seed.pageId)
		);
	}
});

test.describe('two simple-payment blocks sharing one blockId', () => {
	test('rejects the payment with 409 ambiguous_block instead of charging the first match', async ({
		page,
	}) => {
		const nonceRes = await page.request.get(
			'/wp-json/fair-payments-connector/v1/nonce'
		);
		const { nonce } = await nonceRes.json();

		const res = await page.request.post(
			'/wp-json/fair-payments-connector/v1/payments',
			{
				data: {
					amount: String(seed.amounts[0]),
					currency: 'EUR',
					post_id: seed.pageId,
					block_id: seed.blockId,
					nonce,
				},
			}
		);

		expect(res.status()).toBe(409);
		const body = await res.json();
		expect(body.code).toBe('ambiguous_block');
	});
});
