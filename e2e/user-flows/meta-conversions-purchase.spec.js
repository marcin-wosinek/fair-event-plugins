/**
 * E2E: Meta Conversions API reporting for both payment modes (#1589).
 *
 * Before this ticket, a consented checkout/purchase was only ever queued for
 * delivery when the underlying transaction was in LIVE mode — but this wp-env
 * instance forces fair-payments-connector into Mollie "test" mode for every
 * spec (see fair-e2e-support.php §2), so the whole Meta Conversions feature
 * was previously untestable end to end and its outbox stayed permanently
 * empty here. This spec is the first to exercise it live: a consented
 * test-mode purchase must now enqueue and deliver both `InitiateCheckout` and
 * `Purchase`, tagged `payment_mode: "test"`, with the configured Test Events
 * code attached to the outgoing Graph API request.
 *
 * Consent and a valid Meta browser identifier are asserted client-side
 * (fair-events-experimental/src/Frontend/meta-attribution.js reads
 * `window.wp_has_consent('marketing')` and the `_fbp`/`_fbc` cookies) — no
 * consent-management plugin is installed here, so each test injects a stub
 * `wp_has_consent` and a synthetic `_fbp` cookie before navigating, exactly
 * mirroring what a real consent banner + the Meta Pixel would leave behind.
 *
 * No real Meta or Mollie call happens. lib/meta-http-double.php intercepts
 * every graph.facebook.com request (pre_http_request) and captures its body;
 * lib/mollie-http-double.php does the same for Mollie. Delivery is
 * asynchronous (a scheduled single event), so specs flush it with
 * `wp cron event run --due-now` before reading outbox state.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, runScript } from '../support/wp-cli.js';

const DATASET_ID = '1234567890123456';
const ACCESS_TOKEN = 'e2e-meta-access-token';
const TEST_EVENT_CODE = 'TEST12345';

/** Set the `fair_events_experimental_features` option to a `{bundle: bool}` map. */
function setExperimentalFeatures(map) {
	const json = JSON.stringify(map).replace(/'/g, "'\\''");
	wpCli(
		`option update fair_events_experimental_features '${json}' --format=json`
	);
}

/**
 * Stub consent-API + Meta browser-identifier cookies before the page loads,
 * exactly what meta-attribution.js requires to attach attribution data.
 *
 * @param {import('@playwright/test').Page} page    Playwright page.
 * @param {string}                          pageUrl  Absolute event page URL (cookie scope).
 */
async function grantMarketingConsent(page, pageUrl) {
	await page.addInitScript(() => {
		// eslint-disable-next-line camelcase -- matches the real consent API's global name.
		window.wp_has_consent = () => true;
	});
	await page.context().addCookies([
		{
			name: '_fbp',
			value: `fb.1.${Date.now()}.e2emetaidentifier`,
			url: pageUrl,
		},
	]);
}

test.describe('Meta Conversions checkout/purchase reporting', () => {
	test.beforeAll(() => {
		setExperimentalFeatures({ 'meta-conversions': true });
		wpCli(
			`option update fair_events_experimental_meta_dataset_id ${DATASET_ID}`
		);
		wpCli(
			`option update fair_events_experimental_meta_access_token ${ACCESS_TOKEN}`
		);
		wpCli(
			`option update fair_events_experimental_meta_test_event_code ${TEST_EVENT_CODE}`
		);
	});

	test.afterAll(() => {
		wpCli('option delete fair_events_experimental_features');
		wpCli('option delete fair_events_experimental_meta_dataset_id');
		wpCli('option delete fair_events_experimental_meta_access_token');
		wpCli('option delete fair_events_experimental_meta_test_event_code');
	});

	test.beforeEach(() => {
		wpCli('option delete fair_e2e_meta_requests');
		wpCli('option delete fair_e2e_meta_last_request');
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
	});

	test.afterEach(() => {
		// Leave the double reporting "paid", the default every other spec assumes.
		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'paid');
	});

	test('a consented test-mode purchase registers InitiateCheckout and Purchase in Meta Test Events', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid');
		const stamp = Date.now();
		const email = `meta.consented.${stamp}@example.test`;

		await grantMarketingConsent(page, event.pageUrl);
		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await form.locator('input[name="ticket_type_id"]').check();
		await form.locator('input[name="name"]').fill(`E2E Meta ${stamp}`);
		await form.locator('input[name="email"]').fill(email);
		await form.locator('.form-button').click();

		// The Mollie double reports "paid" straight away, so the checkout
		// callback's sync-before-you-read confirms in place — the real
		// fair_payment_paid chain, including Conversions::payment_paid(),
		// fires from that render.
		await expect(
			page.getByText('Payment confirmed', { exact: false })
		).toBeVisible({ timeout: 30000 });

		const signup = runScript(
			'signup-state.php',
			'E2E_STATE',
			`${email} ${event.eventDateId}`
		);
		expect(signup.transaction_id).toBeTruthy();

		// Delivery is deferred to a scheduled single event; flush it.
		wpCli('cron event run --due-now');

		const state = runScript(
			'meta-conversions-state.php',
			'E2E_META_STATE',
			String(signup.transaction_id)
		);
		expect(state.rows.map((row) => row.event_name).sort()).toEqual([
			'InitiateCheckout',
			'Purchase',
		]);
		for (const row of state.rows) {
			expect(row.state).toBe('accepted');
			// wp-env forces fair-payments-connector into Mollie test mode for
			// every spec (fair-e2e-support.php §2) — this is the live
			// assertion that a test-mode transaction is still delivered, and
			// tagged as such, rather than silently dropped as it was before
			// this ticket.
			expect(row.payment_mode).toBe('test');
		}

		const purchaseRequest = state.requests.find(
			(request) => request?.data?.[0]?.event_name === 'Purchase'
		);
		expect(purchaseRequest).toBeTruthy();
		expect(purchaseRequest.test_event_code).toBe(TEST_EVENT_CODE);
		expect(purchaseRequest.data[0].custom_data.payment_mode).toBe('test');
		expect(purchaseRequest.data[0].custom_data.order_id).toBe(
			String(signup.transaction_id)
		);

		const checkoutRequest = state.requests.find(
			(request) => request?.data?.[0]?.event_name === 'InitiateCheckout'
		);
		expect(checkoutRequest).toBeTruthy();
		expect(checkoutRequest.test_event_code).toBe(TEST_EVENT_CODE);
	});

	test('a failed payment does not register a Purchase event', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid');
		const stamp = Date.now();
		const email = `meta.failed.${stamp}@example.test`;

		runScript('set-mollie-status.php', 'E2E_MOLLIE_STATUS', 'failed');

		await grantMarketingConsent(page, event.pageUrl);
		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await form.locator('input[name="ticket_type_id"]').check();
		await form
			.locator('input[name="name"]')
			.fill(`E2E Meta Failed ${stamp}`);
		await form.locator('input[name="email"]').fill(email);
		await form.locator('.form-button').click();

		// The checkout callback's sync-before-you-read resolves the failed
		// status on this first render and shows the retry screen.
		await expect(
			page.getByText("Your payment didn't go through", { exact: false })
		).toBeVisible({ timeout: 30000 });

		const signup = runScript(
			'signup-state.php',
			'E2E_STATE',
			`${email} ${event.eventDateId}`
		);
		expect(signup.transaction_id).toBeTruthy();

		wpCli('cron event run --due-now');

		const state = runScript(
			'meta-conversions-state.php',
			'E2E_META_STATE',
			String(signup.transaction_id)
		);
		// The checkout itself was still consented and eligible — InitiateCheckout
		// enqueues as soon as a checkout URL exists, before Mollie ever reports
		// an outcome — but a failed payment must never produce a Purchase event.
		expect(state.rows.map((row) => row.event_name)).toEqual([
			'InitiateCheckout',
		]);
	});

	test('a repeated paid webhook notification does not duplicate the Purchase event', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid');
		const stamp = Date.now();
		const email = `meta.duplicate.${stamp}@example.test`;

		await grantMarketingConsent(page, event.pageUrl);
		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await form.locator('input[name="ticket_type_id"]').check();
		await form
			.locator('input[name="name"]')
			.fill(`E2E Meta Duplicate ${stamp}`);
		await form.locator('input[name="email"]').fill(email);
		await form.locator('.form-button').click();
		await expect(
			page.getByText('Payment confirmed', { exact: false })
		).toBeVisible({ timeout: 30000 });

		const signup = runScript(
			'signup-state.php',
			'E2E_STATE',
			`${email} ${event.eventDateId}`
		);
		wpCli('cron event run --due-now');

		const transaction = runScript(
			'transaction-state.php',
			'E2E_TX_STATE',
			String(signup.transaction_id)
		);
		expect(transaction.mollie_payment_id).toBeTruthy();

		// Simulate Mollie re-sending the same "paid" webhook notification for a
		// transaction that's already paid — handle_payment_status_change() has
		// no guard against reprocessing, by design (a repeated legitimate
		// notification must still reconcile state), so the outbox's own
		// (transaction_id, event_name) uniqueness is what must prevent a
		// second conversion.
		const webhookResponse = await page.request.post(
			'/wp-json/fair-payments-connector/v1/webhook',
			{ form: { id: transaction.mollie_payment_id } }
		);
		expect(webhookResponse.ok()).toBe(true);
		wpCli('cron event run --due-now');

		const state = runScript(
			'meta-conversions-state.php',
			'E2E_META_STATE',
			String(signup.transaction_id)
		);
		expect(state.rows.map((row) => row.event_name).sort()).toEqual([
			'InitiateCheckout',
			'Purchase',
		]);

		const purchaseRequests = state.requests.filter(
			(request) =>
				request?.data?.[0]?.event_name === 'Purchase' &&
				request?.data?.[0]?.custom_data?.order_id ===
					String(signup.transaction_id)
		);
		expect(purchaseRequests).toHaveLength(1);
	});
});
