import { test, expect, request } from '@playwright/test';
import { loginAsAdmin, ADMIN_USER, ADMIN_PASSWORD } from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('Connected Site availability (#1619)', () => {
	let api;
	let siteId;
	let siteLabel;

	test.beforeAll(async ({ baseURL }) => {
		api = await request.newContext({ baseURL });
		siteLabel = `E2E enabled toggle ${Date.now()}`;
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

	test('a disabled site cannot be imported from External Updates, and re-enabling restores it (#1695)', async ({
		page,
	}) => {
		await loginAsAdmin(page);

		const importButton = () =>
			page.getByRole('button', {
				name: `Import transactions from ${siteLabel}`,
			});

		// The newly created site is enabled by default and can be imported.
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-external-updates'
		);
		await expect(importButton()).toBeEnabled();

		// Disable it from the Connected Sites management page.
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-connected-sites'
		);
		const row = page.locator('tr', { hasText: siteLabel });
		await row.getByRole('button', { name: 'Disable' }).click();
		await expect(row.getByText('Disabled')).toBeVisible();

		// It stays listed with the reason, but cannot be imported.
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-external-updates'
		);
		await expect(importButton()).toBeDisabled();
		await expect(
			page
				.locator('li', { hasText: siteLabel })
				.getByText(
					'Disabled. Enable it on the Connected Sites page to import from it.'
				)
		).toBeVisible();

		// Re-enable it and confirm it can be imported again.
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-connected-sites'
		);
		await row.getByRole('button', { name: 'Enable' }).click();
		await expect(row.getByText('Enabled')).toBeVisible();

		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-external-updates'
		);
		await expect(importButton()).toBeEnabled();
	});
});
