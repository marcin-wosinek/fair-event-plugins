/**
 * E2E: the payment-return notice (#2050).
 *
 * The connector's fallback notice reports a payment only on pages where no
 * block renders its own result. It reads the status with the access token the
 * browser holds in session storage, sent in a header (#858) — never from or
 * in a URL — and says it cannot verify the status, rather than reporting a
 * failure, when that read is not possible.
 *
 * Run: `npm run test:e2e:local -- e2e/user-flows/payment-return-notification.spec.js`.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript, wpCli } from '../support/wp-cli.js';

const NOTICE = '.fair-payments-connector-notification';
const KEY_PREFIX = 'fairPaymentsConnector.accessToken.';

let plainPage;
let paymentPage;
const seeded = [];

function seedTransaction(status) {
	const transaction = runScript(
		'seed-callback-transaction.php',
		'E2E_CALLBACK_TX',
		status
	);
	seeded.push(transaction);
	return transaction;
}

function returnUrl(pageUrl, transaction) {
	const url = new URL(pageUrl);
	url.searchParams.set('fair_payment_callback', 'true');
	url.searchParams.set('transaction_id', String(transaction.transactionId));
	return url.toString();
}

/**
 * Hold a transaction's token in session storage, as the checkout page would.
 *
 * @param {import('@playwright/test').Page} page        Playwright page.
 * @param {object}                          transaction Seeded transaction.
 */
async function holdToken(page, transaction) {
	await page.addInitScript(
		([key, token]) => window.sessionStorage.setItem(key, token),
		[`${KEY_PREFIX}${transaction.transactionId}`, transaction.token]
	);
}

/**
 * Record every status request the page sends.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {import('@playwright/test').Request[]} Live list of requests.
 */
function statusRequests(page) {
	const requests = [];
	page.on('request', (request) => {
		if (
			/fair-payments-connector\/v1\/payments\/\d+\/status/.test(
				request.url()
			)
		) {
			requests.push(request);
		}
	});
	return requests;
}

test.beforeAll(() => {
	const id = wpCli(
		`post create --post_type=page --post_status=publish --post_title='E2E payment return' --post_content='<!-- wp:paragraph --><p>Plain page.</p><!-- /wp:paragraph -->' --porcelain`
	).trim();
	plainPage = {
		id,
		url: wpCli(`post url ${id}`).trim(),
	};
	paymentPage = runScript(
		'seed-payment-page.php',
		'E2E_PAYMENT_PAGE',
		'12.50'
	);
});

test.afterAll(() => {
	for (const transaction of seeded) {
		runScript(
			'cleanup-callback-transaction.php',
			'E2E_CALLBACK_TX_CLEANUP',
			String(transaction.transactionId)
		);
	}
	if (plainPage) {
		wpCli(`post delete ${plainPage.id} --force`, {
			allowFailure: true,
		});
	}
	if (paymentPage) {
		runScript(
			'cleanup-payment-page.php',
			'E2E_PAYMENT_CLEANUP',
			String(paymentPage.pageId)
		);
	}
});

test.describe('payment return notice', () => {
	test('reports a verified payment on a page without a payment block', async ({
		page,
	}) => {
		const transaction = seedTransaction('paid');
		await holdToken(page, transaction);
		const requests = statusRequests(page);
		const sent = [];
		page.on('request', (request) => {
			sent.push(request.url(), request.headers().referer || '');
		});

		await page.goto(returnUrl(plainPage.url, transaction));

		const notice = page.locator(NOTICE);
		await expect(notice).toHaveCount(1);
		await expect(notice).toHaveAttribute('role', 'status');
		await expect(notice).toContainText('has been received and confirmed');
		await expect(notice).toContainText('12.50');
		await expect(notice).toContainText('Test mode');

		// The token travels in a header only.
		expect(requests.length).toBeGreaterThan(0);
		for (const request of requests) {
			expect(request.headers()['x-fair-payment-token']).toBe(
				transaction.token
			);
		}
		for (const url of sent) {
			expect(url).not.toContain(transaction.token);
		}

		// Polling stops on a terminal status: still one notice.
		await page.waitForTimeout(3500);
		await expect(notice).toHaveCount(1);

		// Keyboard dismissal.
		await page
			.getByRole('button', { name: 'Dismiss payment notice' })
			.focus();
		await page.keyboard.press('Enter');
		await expect(notice).toHaveCount(0);
	});

	test('says it cannot verify, never that the payment failed, without a stored token', async ({
		page,
	}) => {
		const transaction = seedTransaction('paid');

		// A token in the URL is ignored.
		const url = new URL(returnUrl(plainPage.url, transaction));
		url.searchParams.set('token', transaction.token);
		const requests = statusRequests(page);

		await page.goto(url.toString());

		const notice = page.locator(NOTICE);
		await expect(notice).toContainText(
			'couldn’t verify your payment status'
		);
		await expect(notice).not.toContainText(/not completed|try again/i);
		expect(requests.length).toBeGreaterThan(0);
		for (const request of requests) {
			expect(request.url()).not.toContain(transaction.token);
			expect(request.headers()['x-fair-payment-token']).toBeUndefined();
		}
	});

	test('says it cannot verify when the status request fails', async ({
		page,
	}) => {
		const transaction = seedTransaction('failed');
		await holdToken(page, transaction);
		await page.route(/payments\/\d+\/status/, (route) =>
			route.fulfill({ status: 500, body: '{}' })
		);

		await page.goto(returnUrl(plainPage.url, transaction));

		const notice = page.locator(NOTICE);
		await expect(notice).toContainText(
			'couldn’t verify your payment status'
		);
		await expect(notice).not.toContainText(/not completed|try again/i);
	});

	test('leaves a Simple Payment return to the block', async ({ page }) => {
		const transaction = seedTransaction('paid');
		await holdToken(page, transaction);

		await page.goto(returnUrl(paymentPage.pageUrl, transaction));

		await expect(
			page.locator('.fair-payments-connector-success')
		).toBeVisible({ timeout: 30000 });
		await expect(page.locator(NOTICE)).toHaveCount(0);
	});

	test('leaves a ticket purchase return to the signup block', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid', { block: 'get-tickets' });
		const stamp = Date.now();

		await page.goto(event.pageUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await form.locator('input[name="name"]').fill(`Return ${stamp}`);
		await form
			.locator('input[name="email"]')
			.fill(`payment-return.${stamp}@example.test`);
		await form
			.locator(
				`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
			)
			.check();
		await form.locator('button[type="submit"]').click();

		await expect(
			page.locator('.fair-events-get-tickets-callback-confirmed')
		).toBeVisible({ timeout: 30000 });
		await expect(page).toHaveURL(/fair_payment_callback=true/);
		await expect(page.locator(NOTICE)).toHaveCount(0);
	});
});
