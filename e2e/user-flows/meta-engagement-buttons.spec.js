/**
 * E2E: Meta engagement events for event-page buttons (#1838, #1970).
 *
 * A consented visitor who activates the calendar button or a designated
 * ticket button (class `fair-events-ticket-button`, on the link or its
 * wrapper) sends one `FairEventCalendarClick` / `FairEventTicketClick`
 * event carrying the event post and date — never the button's destination.
 * WordPress sends it to Meta immediately, in the capture request, without
 * WP-Cron. Capture must not change what the button does: the calendar
 * dropdown still opens, a same-page ticket link still jumps, and a link to
 * another purchase page still navigates, also when capture or Meta is slow
 * or fails.
 *
 * Consent is stubbed the same way as meta-conversions-purchase.spec.js:
 * `window.wp_has_consent` plus a synthetic `_fbp` cookie. lib/meta-http-double.php
 * answers every Graph API request; the `fair_e2e_meta_response` option makes
 * it slow or failing. Cron is never run.
 *
 * Run: `npm run test:e2e:local -- e2e/user-flows/meta-engagement-buttons.spec.js`.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, runScript } from '../support/wp-cli.js';

const CAPTURE = /\/fair-events-experimental\/v1\/meta-engagement/;
const PURCHASE_PATH = '/?e2e-purchase-page=1';

/** Set the `fair_events_experimental_features` option to a `{bundle: bool}` map. */
function setExperimentalFeatures(map) {
	const json = JSON.stringify(map).replace(/'/g, "'\\''");
	wpCli(
		`option update fair_events_experimental_features '${json}' --format=json`
	);
}

/**
 * Stub the consent API and a Meta browser identifier before the page loads.
 *
 * @param {import('@playwright/test').Page} page    Playwright page.
 * @param {string}                          pageUrl Event page URL (cookie scope).
 */
async function grantMarketingConsent(page, pageUrl) {
	await page.addInitScript(() => {
		// eslint-disable-next-line camelcase -- matches the real consent API's global name.
		window.wp_has_consent = () => true;
	});
	await page.context().addCookies([
		{
			name: '_fbp',
			value: `fb.1.${Date.now()}.e2eengagement`,
			url: pageUrl,
		},
	]);
}

/**
 * Read the post's outbox rows and the Graph requests sent for it.
 *
 * @param {number} postId Event post ID.
 * @return {{rows: Array, requests: Array}} State.
 */
function deliveredState(postId) {
	const state = runScript(
		'meta-engagement-state.php',
		'E2E_META_ENGAGEMENT',
		String(postId)
	);
	return {
		rows: state.rows,
		requests: state.requests
			.map((request) => request?.data?.[0])
			.filter((event) => event?.custom_data?.post_id === postId),
	};
}

/**
 * Close the calendar dropdown with an outside click. The dropdown starts
 * listening for outside clicks in a timeout, so retry until it closes.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 */
async function closeCalendarDropdown(page) {
	await expect(async () => {
		await page.mouse.click(1, 1);
		await expect(page.locator('.calendar-dropdown')).toHaveCount(0, {
			timeout: 500,
		});
	}).toPass();
}

/** Collect capture requests the page sends. */
function recordCaptures(page) {
	const captures = [];
	page.on('request', (request) => {
		if (CAPTURE.test(request.url()) && request.method() === 'POST') {
			captures.push(request.postDataJSON());
		}
	});
	return captures;
}

test.describe('Meta engagement button events', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(() => {
		setExperimentalFeatures({ 'meta-conversions': true });
		wpCli(
			'option update fair_events_experimental_meta_dataset_id 1234567890123456'
		);
		wpCli(
			'option update fair_events_experimental_meta_access_token e2e-meta-access-token'
		);
	});

	test.afterAll(() => {
		wpCli('option delete fair_events_experimental_features');
		wpCli('option delete fair_events_experimental_meta_dataset_id');
		wpCli('option delete fair_events_experimental_meta_access_token');
	});

	test.beforeEach(() => {
		wpCli('option delete fair_e2e_meta_requests', { allowFailure: true });
		wpCli('option delete fair_e2e_meta_response', { allowFailure: true });
		// Delivery must not depend on scheduling: drop any queued worker run.
		wpCli('cron event delete fair_events_experimental_meta_deliver', {
			allowFailure: true,
		});
	});

	test.afterEach(() => {
		wpCli('option delete fair_e2e_meta_response', { allowFailure: true });
	});

	test('the calendar button sends one calendar event and still opens the dropdown', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('meta-engagement');
		await grantMarketingConsent(page, event.pageUrl);
		const captures = recordCaptures(page);
		await page.goto(event.pageUrl);
		await page.waitForLoadState('networkidle');
		expect(captures).toHaveLength(0);

		const response = page.waitForResponse(CAPTURE);
		await page.getByText('Add to calendar').click();
		const answer = await response;
		expect(answer.status()).toBe(200);
		expect(await answer.json()).toEqual({ received: true });
		await expect(page.locator('.calendar-dropdown')).toBeVisible();

		// A provider choice inside the dropdown is not counted again.
		const download = page.waitForEvent('download');
		await page.locator('.calendar-dropdown [data-provider="ics"]').click();
		await download;
		await expect(page.locator('.calendar-dropdown')).toHaveCount(0);
		await page.waitForLoadState('networkidle');
		expect(captures).toHaveLength(1);
		expect(captures[0]).toMatchObject({
			action: 'calendar',
			post_id: event.eventId,
			event_date_id: event.eventDateId,
		});

		const state = deliveredState(event.eventId);
		expect(state.rows).toEqual([
			{
				event_name: 'FairEventCalendarClick',
				state: 'immediate_received',
				event_date_id: String(event.eventDateId),
				transaction_id: null,
				fbp: '',
				fbc: '',
				meta_diagnostics: {
					http_status: 200,
					events_received: 1,
					messages: [],
					fbtrace_id: 'E2Efbtrace00000',
				},
			},
		]);
		expect(state.requests[0]).not.toHaveProperty('test_event_code');
		expect(state.requests).toHaveLength(1);
		expect(state.requests[0].custom_data).toEqual({
			post_id: event.eventId,
			event_date_id: event.eventDateId,
			action: 'calendar',
		});
		expect(state.requests[0].event_source_url).toBe(event.pageUrl);
		// The visitor's own browser, read from the tracking request.
		expect(state.requests[0].user_data.client_user_agent).toBe(
			await page.evaluate(() => navigator.userAgent)
		);
	});

	test('a keyboard-activated same-page ticket jump sends one ticket event and still jumps', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('meta-engagement');
		await grantMarketingConsent(page, event.pageUrl);
		const captures = recordCaptures(page);
		await page.goto(event.pageUrl);

		const response = page.waitForResponse(CAPTURE);
		await page.getByRole('link', { name: 'Get tickets' }).focus();
		await page.keyboard.press('Enter');
		expect((await response).status()).toBe(200);
		await expect(page).toHaveURL(/#tickets$/);
		await expect(page.locator('#tickets')).toBeInViewport();
		expect(captures).toHaveLength(1);
		expect(captures[0].action).toBe('ticket');

		const state = deliveredState(event.eventId);
		expect(state.rows.map((row) => row.event_name)).toEqual([
			'FairEventTicketClick',
		]);
		expect(JSON.stringify(state.requests)).not.toContain('#tickets');
	});

	test('a ticket link to another purchase page navigates and is recorded', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('meta-engagement', {
			purchaseUrl: PURCHASE_PATH,
		});
		await grantMarketingConsent(page, event.pageUrl);
		await page.goto(event.pageUrl);

		await page
			.getByRole('link', { name: 'Buy on the purchase page' })
			.click();
		await expect(page).toHaveURL(/e2e-purchase-page=1/);

		// keepalive lets the capture finish after the navigation.
		await expect
			.poll(() => deliveredState(event.eventId).rows.length)
			.toBe(1);
		const state = deliveredState(event.eventId);
		expect(state.rows[0].event_name).toBe('FairEventTicketClick');
		expect(JSON.stringify(state.requests)).not.toContain(
			'e2e-purchase-page'
		);
	});

	test('failed capture leaves every button working', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('meta-engagement', {
			purchaseUrl: PURCHASE_PATH,
		});
		await grantMarketingConsent(page, event.pageUrl);
		await page.route(CAPTURE, (route) => route.abort('failed'));
		await page.goto(event.pageUrl);

		await page.getByText('Add to calendar').click();
		await expect(page.locator('.calendar-dropdown')).toBeVisible();
		await closeCalendarDropdown(page);

		await page.getByRole('link', { name: 'Get tickets' }).click();
		await expect(page).toHaveURL(/#tickets$/);

		await page
			.getByRole('link', { name: 'Buy on the purchase page' })
			.click();
		await expect(page).toHaveURL(/e2e-purchase-page=1/);

		expect(deliveredState(event.eventId).rows).toEqual([]);
	});

	test('slow Meta delivery never holds up the buttons', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('meta-engagement', {
			purchaseUrl: PURCHASE_PATH,
		});
		wpCli(
			`option update fair_e2e_meta_response '${JSON.stringify({ delay: 3 })}' --format=json`
		);
		await grantMarketingConsent(page, event.pageUrl);
		await page.goto(event.pageUrl);

		// Each button reacts well before the double answers, three seconds later.
		await page.getByText('Add to calendar').click();
		await expect(page.locator('.calendar-dropdown')).toBeVisible({
			timeout: 1500,
		});
		await closeCalendarDropdown(page);

		await page.getByRole('link', { name: 'Get tickets' }).click();
		await expect(page).toHaveURL(/#tickets$/, { timeout: 1500 });

		await page
			.getByRole('link', { name: 'Buy on the purchase page' })
			.click();
		await expect(page).toHaveURL(/e2e-purchase-page=1/, {
			timeout: 1500,
		});

		// Each send is reserved at once and finishes when Meta answers.
		await expect
			.poll(
				() =>
					deliveredState(event.eventId).rows.map((row) => row.state),
				{ timeout: 20000 }
			)
			.toEqual([
				'immediate_received',
				'immediate_received',
				'immediate_received',
			]);
	});

	test('a failed Meta delivery is recorded once and leaves the buttons working', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('meta-engagement');
		wpCli(
			`option update fair_e2e_meta_response '${JSON.stringify({ transport: true })}' --format=json`
		);
		await grantMarketingConsent(page, event.pageUrl);
		await page.goto(event.pageUrl);

		const response = page.waitForResponse(CAPTURE);
		await page.getByText('Add to calendar').click();
		const answer = await response;
		expect(answer.status()).toBe(200);
		expect(await answer.json()).toEqual({ received: false });
		await expect(page.locator('.calendar-dropdown')).toBeVisible();

		const state = deliveredState(event.eventId);
		expect(state.rows.map((row) => row.state)).toEqual([
			'immediate_transport',
		]);
		expect(state.requests).toHaveLength(1);

		// The worker never retries an immediate send.
		wpCli('cron event run --due-now');
		expect(deliveredState(event.eventId).requests).toHaveLength(1);
	});

	test('without marketing consent nothing is sent', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('meta-engagement');
		await page.context().addCookies([
			{
				name: '_fbp',
				value: `fb.1.${Date.now()}.e2eengagement`,
				url: event.pageUrl,
			},
		]);
		const captures = recordCaptures(page);
		await page.goto(event.pageUrl);

		await page.getByText('Add to calendar').click();
		await expect(page.locator('.calendar-dropdown')).toBeVisible();
		await closeCalendarDropdown(page);
		await page.getByRole('link', { name: 'Get tickets' }).click();
		await expect(page).toHaveURL(/#tickets$/);

		expect(captures).toHaveLength(0);
		expect(deliveredState(event.eventId).rows).toEqual([]);
	});
});
