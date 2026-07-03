/**
 * E2E: fair-payments-connector simple-payment block — full purchase lifecycle.
 *
 * The PaymentEndpoint's security checks are covered by API specs; this drives
 * the real browser flow: the block renders its Pay Now button (Mollie
 * configured via the e2e dummy key), the click fetches a fresh nonce and
 * creates a payment, the Mollie double's checkout link sends the buyer
 * straight back to the callback URL, and — as in production — Mollie's
 * webhook flips the transaction to paid, which the block's status poller
 * picks up and renders as the confirmed message.
 *
 * Also exercises the failure-free "processing" intermediate state and the
 * per-transaction access-token gating baked into the callback URL.
 */

import { test, expect } from '@playwright/test';
import { runScript } from '../support/wp-cli.js';

let seed;

test.beforeAll(() => {
	seed = runScript('seed-payment-page.php', 'E2E_PAYMENT_PAGE', '12.50');
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

test.describe('simple-payment block purchase', () => {
	test('pay → callback → webhook → confirmed message and paid transaction', async ({
		page,
	}) => {
		await page.goto(seed.pageUrl);

		// Mollie is configured (dummy e2e key), so the button renders — not the
		// "gateway is not configured" fallback.
		const payButton = page.locator('.fair-payments-connector-button');
		await expect(payButton).toBeVisible();
		await expect(
			page.locator('.fair-payments-connector-not-configured')
		).toHaveCount(0);

		// Click → nonce fetch + POST /payments → redirect through the Mollie
		// double back to ?fair_payment_callback=true&transaction_id=…&token=….
		// Wait for the rendered processing state rather than the navigation
		// itself (waitForURL can abort when a redirect supersedes it — see
		// ticket-purchase-confirmation.spec.js), then assert the URL by polling.
		await payButton.click();
		await expect(
			page.locator('.fair-payments-connector-processing')
		).toBeVisible({ timeout: 30000 });
		await expect(page).toHaveURL(/fair_payment_callback=true/);

		const url = new URL(page.url());
		const transactionId = url.searchParams.get('transaction_id');
		expect(transactionId).toBeTruthy();

		let tx = runScript(
			'transaction-state.php',
			'E2E_TX_STATE',
			transactionId
		);
		expect(tx.found).toBe(true);
		expect(tx.post_id).toBe(seed.pageId);
		expect(tx.amount).toBe(seed.amount);
		expect(tx.mollie_payment_id).toBeTruthy();

		// Simulate Mollie's webhook call (production path): the handler fetches
		// the payment from the double, which reports it paid.
		const webhookResponse = await page.request.post(
			'/wp-json/fair-payments-connector/v1/webhook',
			{ form: { id: tx.mollie_payment_id } }
		);
		expect(webhookResponse.ok()).toBe(true);

		// The block's poller flips the UI to the confirmed message.
		await expect(
			page.getByText('Your payment has been received and confirmed', {
				exact: false,
			})
		).toBeVisible({ timeout: 30000 });

		// Server-side: the transaction row is paid, in test mode.
		tx = runScript('transaction-state.php', 'E2E_TX_STATE', transactionId);
		expect(tx.status).toBe('paid');
		expect(tx.testmode).toBe(true);
	});
});
