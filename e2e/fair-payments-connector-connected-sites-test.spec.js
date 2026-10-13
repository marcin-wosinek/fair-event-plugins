import { test, expect, request } from '@playwright/test';
import { loginAsAdmin, ADMIN_USER, ADMIN_PASSWORD } from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('Connected Site connection test feedback (#1799)', () => {
	let api;
	let siteId;
	let siteLabel;

	test.beforeAll(async ({ baseURL }) => {
		api = await request.newContext({ baseURL });
		siteLabel = `E2E failing test ${Date.now()}`;
		// The reserved .invalid TLD never resolves, so the test always fails
		// without depending on any remote service.
		const res = await api.post(
			'/wp-json/fair-payments-connector/v1/admin/connected-sites',
			{
				headers: adminHeaders,
				data: {
					label: siteLabel,
					base_url: 'https://e2e-connected-site.invalid',
					token: 'e2e-test-token',
				},
			}
		);
		expect(res.ok(), await res.text()).toBeTruthy();
		siteId = (await res.json()).id;
	});

	test.afterAll(async () => {
		if (siteId) {
			await api.delete(
				`/wp-json/fair-payments-connector/v1/admin/connected-sites/${siteId}`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	});

	test('a failed test explains itself, survives the table refresh, and can be dismissed', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-connected-sites'
		);

		const row = page.locator('tr', { hasText: siteLabel });
		await expect(row.getByText('Unverified')).toBeVisible();
		await row.getByRole('button', { name: 'Test' }).click();

		// The refreshed row reports the failure…
		await expect(row.getByText('Error', { exact: true })).toBeVisible();

		// …and the explanation is still there once the table is back.
		const notice = page.locator('.components-notice.is-error', {
			hasText: `Connection test failed for ${siteLabel}`,
		});
		await expect(notice).toBeVisible();
		await expect(notice).toContainText('Could not reach the remote site.');

		await notice.getByRole('button', { name: 'Close' }).click();
		await expect(notice).toHaveCount(0);
		await expect(row.getByText('Error', { exact: true })).toBeVisible();
	});
});
