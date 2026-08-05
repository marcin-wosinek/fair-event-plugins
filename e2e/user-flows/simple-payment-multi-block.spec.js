/**
 * E2E: fair-payments-connector — two Simple Payment blocks with distinct
 * identifiers and different prices coexisting on one page.
 *
 * Covers the fix for #1325: PaymentEndpoint::find_blocks_by_id() must resolve
 * each block's own saved amount rather than the first block on the page, and
 * each button must render its own blockId/amount (the editor's
 * duplicate-detection guarantees distinct ids).
 */

import { test, expect } from '@playwright/test';
import { runScript } from '../support/wp-cli.js';

let seed;

test.beforeAll(() => {
	seed = runScript(
		'seed-payment-page-multi.php',
		'E2E_PAYMENT_PAGE_MULTI',
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

test.describe('two simple-payment blocks on one page', () => {
	test('each button renders its own blockId and amount', async ({ page }) => {
		await page.goto(seed.pageUrl);

		const buttons = page.locator('.fair-payments-connector-button');
		await expect(buttons).toHaveCount(2);

		for (let i = 0; i < seed.blocks.length; i++) {
			await expect(buttons.nth(i)).toHaveAttribute(
				'data-block-id',
				seed.blocks[i].blockId
			);
			await expect(buttons.nth(i)).toHaveAttribute(
				'data-amount',
				String(seed.blocks[i].amount)
			);
		}
	});

	test("the endpoint charges each block its own price, not the other block's", async ({
		page,
	}) => {
		const nonceRes = await page.request.get(
			'/wp-json/fair-payments-connector/v1/nonce'
		);
		const { nonce } = await nonceRes.json();

		const [block1, block2] = seed.blocks;

		// Submitting block 1's own amount against block 1's id succeeds.
		const okRes = await page.request.post(
			'/wp-json/fair-payments-connector/v1/payments',
			{
				data: {
					amount: String(block1.amount),
					currency: 'EUR',
					post_id: seed.pageId,
					block_id: block1.blockId,
					nonce,
				},
			}
		);
		expect(okRes.status()).toBe(201);

		// Submitting block 1's (lower) amount against block 2's id is rejected —
		// proving the endpoint resolved block 2's own, higher price rather than
		// reusing whichever block it matched first.
		const rejectedRes = await page.request.post(
			'/wp-json/fair-payments-connector/v1/payments',
			{
				data: {
					amount: String(block1.amount),
					currency: 'EUR',
					post_id: seed.pageId,
					block_id: block2.blockId,
					nonce,
				},
			}
		);
		expect(rejectedRes.status()).toBe(422);
		const body = await rejectedRes.json();
		expect(body.code).toBe('amount_too_low');
	});
});
