/**
 * E2E: the administrator FairEventCalendarClick test in Fair Events →
 * Settings → Experimental (#1838).
 *
 * The admin picks an event, the page reads this browser's marketing consent
 * and `_fbp` cookie at send time, and the test goes to Meta with the Test
 * Events code and the production calendar payload. Meta's diagnostics stay
 * visible after the notice, also when Meta does not confirm the event.
 *
 * Consent is stubbed like the other Meta specs: `window.wp_has_consent` plus
 * a synthetic `_fbp` cookie. lib/meta-http-double.php answers the Graph API;
 * the `fair_e2e_meta_response` option switches its answer.
 *
 * Run: `npm run test:e2e:local -- e2e/user-flows/meta-calendar-test.spec.js`.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, loginAsAdmin } from '../support/wp-cli.js';

const SETTINGS_URL =
	'/wp-admin/admin.php?page=fair-events-settings&tab=experimental';
const FBP = `fb.1.${Date.now()}.e2ecalendartest`;

/** Read the decoded body of the last Graph API request. */
function lastMetaRequest() {
	const out = wpCli('option get fair_e2e_meta_last_request --format=json');
	return JSON.parse(out.slice(out.indexOf('{')));
}

test.describe('Meta calendar click test', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(() => {
		wpCli(
			`option update fair_events_experimental_features '{"meta-conversions":true}' --format=json`
		);
		wpCli(
			'option update fair_events_experimental_meta_dataset_id 1234567890123456'
		);
		wpCli(
			'option update fair_events_experimental_meta_access_token e2e-meta-access-token'
		);
		wpCli(
			'option update fair_events_experimental_meta_test_event_code TEST12345'
		);
	});

	test.afterAll(() => {
		wpCli('option delete fair_events_experimental_features');
		wpCli('option delete fair_events_experimental_meta_dataset_id');
		wpCli('option delete fair_events_experimental_meta_access_token');
		wpCli('option delete fair_events_experimental_meta_test_event_code');
		wpCli('option delete fair_events_experimental_meta_test_log', {
			allowFailure: true,
		});
		wpCli('option delete fair_e2e_meta_response', { allowFailure: true });
	});

	async function openSettingsWithConsent(page, baseURL) {
		await page.addInitScript(() => {
			// eslint-disable-next-line camelcase -- matches the real consent API's global name.
			window.wp_has_consent = () => true;
		});
		await page
			.context()
			.addCookies([{ name: '_fbp', value: FBP, url: baseURL }]);
		await loginAsAdmin(page);
		await page.goto(SETTINGS_URL);
	}

	async function chooseEvent(page, event) {
		// Seeded dates are created after their post, so re-save the post to
		// sync its title onto the date row the event search matches, as an
		// editor save does on a real site.
		const title = `E2E calendar test ${event.eventId}-${Date.now()}`;
		wpCli(`post update ${event.eventId} --post_title="${title}"`);
		await page.getByLabel('Search events by title').fill(title);
		const select = page.getByLabel('Event', { exact: true });
		await expect(select.locator('option')).toHaveCount(2);
		await select.selectOption(String(event.eventDateId));
	}

	test('sends the calendar test from the settings page and shows what Meta received', async ({
		page,
		baseURL,
		seedEvent,
	}) => {
		const event = seedEvent('meta-engagement');
		await openSettingsWithConsent(page, baseURL);

		const send = page.getByRole('button', {
			name: 'Send FairEventCalendarClick test',
		});
		await expect(send).toBeDisabled();
		await chooseEvent(page, event);
		await expect(send).toBeEnabled();
		await send.click();

		const latest = page.getByRole('status').filter({
			hasText: 'Latest test result',
		});
		await expect(latest.getByText('Received by Meta')).toBeVisible();
		await expect(latest.getByText('Events received: 1')).toBeVisible();
		await expect(
			latest.getByText('Trace ID: E2Efbtrace00000')
		).toBeVisible();

		const sent = lastMetaRequest();
		expect(sent.test_event_code).toBe('TEST12345');
		expect(sent.data[0]).toMatchObject({
			event_name: 'FairEventCalendarClick',
			user_data: { fbp: FBP },
			custom_data: {
				post_id: event.eventId,
				event_date_id: event.eventDateId,
				action: 'calendar',
			},
			event_source_url: event.pageUrl,
		});
	});

	test('keeps an unconfirmed answer visible with Meta’s messages', async ({
		page,
		baseURL,
		seedEvent,
	}) => {
		const event = seedEvent('meta-engagement');
		wpCli(
			`option update fair_e2e_meta_response '${JSON.stringify({
				status: 200,
				body: {
					events_received: 0,
					messages: ['Event was not processed'],
					fbtrace_id: 'ZeroTrace1',
				},
			})}' --format=json`
		);
		await openSettingsWithConsent(page, baseURL);
		await chooseEvent(page, event);
		await page
			.getByRole('button', { name: 'Send FairEventCalendarClick test' })
			.click();

		const latest = page.getByRole('status').filter({
			hasText: 'Latest test result',
		});
		await expect(latest.getByText('Not confirmed')).toBeVisible();
		await expect(latest.getByText('Events received: 0')).toBeVisible();
		await expect(latest.getByText('Event was not processed')).toBeVisible();
		await expect(latest.getByText('Trace ID: ZeroTrace1')).toBeVisible();
		wpCli('option delete fair_e2e_meta_response');
	});
});
