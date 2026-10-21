/**
 * E2E: inspecting and comparing requests sent to Meta on the Fair Events →
 * Meta page (#2004).
 *
 * Two administrator tests reach Meta — one received, one rejected — and
 * both appear in the sent-request log with the sanitized request beside
 * Meta's answer. Comparing them aligns their fields by path. Credentials
 * and identifiers never appear on the page.
 *
 * lib/meta-http-double.php answers the Graph API; the
 * `fair_e2e_meta_response` option switches its answer.
 *
 * Run: `npm run test:e2e:local -- e2e/user-flows/meta-sent-requests.spec.js`.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, loginAsAdmin } from '../support/wp-cli.js';

const SETTINGS_URL = '/wp-admin/admin.php?page=fair-events-meta';
const TOKEN = 'e2e-meta-access-token';
const TEST_CODE = 'TEST12345';

test.describe('Meta sent requests', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(() => {
		wpCli(
			`option update fair_events_experimental_features '{"meta-conversions":true}' --format=json`
		);
		wpCli(
			'option update fair_events_experimental_meta_dataset_id 1234567890123456'
		);
		wpCli(
			`option update fair_events_experimental_meta_access_token ${TOKEN}`
		);
		wpCli(
			`option update fair_events_experimental_meta_test_event_code ${TEST_CODE}`
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

	test('shows each sent request beside Meta’s answer and compares two', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(SETTINGS_URL);

		await page.getByRole('button', { name: 'Send PageView test' }).click();
		const latest = page.getByRole('status').filter({
			hasText: 'Latest test result',
		});
		await expect(latest.getByText('Received by Meta')).toBeVisible();
		await latest.getByRole('button', { name: 'Show sent request' }).click();
		await expect(
			latest.getByText('Test Events code included')
		).toBeVisible();

		wpCli(
			`option update fair_e2e_meta_response '${JSON.stringify({
				status: 400,
				body: {
					error: {
						message: 'Invalid parameter',
						type: 'OAuthException',
						code: 100,
						fbtrace_id: 'RejectTrace2004',
					},
				},
			})}' --format=json`
		);
		await page.getByRole('button', { name: 'Send Purchase test' }).click();
		await expect(
			latest.getByText('Rejected', { exact: true })
		).toBeVisible();
		wpCli('option delete fair_e2e_meta_response');

		await page.getByRole('button', { name: 'Show sent requests' }).click();
		await page
			.getByLabel('Sent by')
			.selectOption({ label: 'Administrator tests' });
		const firstEntry = page
			.getByRole('button', { name: 'Show details' })
			.first();
		await expect(firstEntry).toBeVisible();
		await expect(page.getByText('Rejected by Meta').first()).toBeVisible();
		await expect(
			page.getByText('Administrator test').first()
		).toBeVisible();
		await expect(
			page.getByText('Sent to Test Events').first()
		).toBeVisible();

		// The newest entry is the rejected Purchase test.
		await firstEntry.click();
		const fields = page
			.getByRole('region', { name: 'Sent request fields' })
			.first();
		await expect(
			fields.getByText('data[0].custom_data.currency')
		).toBeVisible();
		await expect(fields.getByText('USD')).toBeVisible();
		const answer = page
			.locator('section')
			.filter({ hasText: 'Meta’s answer' })
			.first();
		await expect(
			answer.getByText('Trace ID: RejectTrace2004')
		).toBeVisible();
		await expect(answer.getByText('Invalid parameter')).toBeVisible();

		const boxes = page.getByRole('checkbox', { name: 'Compare' });
		await boxes.nth(0).check();
		await boxes.nth(1).check();
		const comparison = page.getByRole('region', {
			name: 'Request comparison',
		});
		await expect(comparison).toBeVisible();
		// PageView has no commerce data, so the Purchase fields differ.
		await expect(
			comparison.getByText('data[0].custom_data.currency')
		).toBeVisible();
		await expect(comparison.getByText('Missing').first()).toBeVisible();

		// The settings form shows the Test Events code in its field; the
		// rendered text — results, the log and the comparison — never does.
		const text = await page.locator('body').innerText();
		expect(text).not.toContain(TOKEN);
		expect(text).not.toContain(TEST_CODE);
	});
});
