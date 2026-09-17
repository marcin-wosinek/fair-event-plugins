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

	test('disabling a site removes it from the import popup, and re-enabling restores it', async ({
		page,
	}) => {
		await loginAsAdmin(page);

		// The newly created site is enabled by default and offered as an
		// import source.
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-transactions'
		);
		await page.getByRole('button', { name: 'Import', exact: true }).click();
		await page.getByRole('button', { name: 'Connected Sites' }).click();
		await expect(page.getByText(siteLabel)).toBeVisible();
		await page.getByRole('button', { name: 'Back' }).click();

		// Disable it from the Connected Sites management page.
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-connected-sites'
		);
		const row = page.locator('tr', { hasText: siteLabel });
		await row.getByRole('button', { name: 'Disable' }).click();
		await expect(row.getByText('Disabled')).toBeVisible();

		// It disappears from the import popup while connected sites still
		// exist.
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-transactions'
		);
		await page.getByRole('button', { name: 'Import', exact: true }).click();
		await page.getByRole('button', { name: 'Connected Sites' }).click();
		await expect(
			page.getByText(
				'No enabled connected sites. Enable one on the Connected Sites page first.'
			)
		).toBeVisible();
		await expect(page.getByText(siteLabel)).toHaveCount(0);
		await page.getByRole('button', { name: 'Back' }).click();

		// Re-enable it and confirm it returns to the import popup.
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-connected-sites'
		);
		await row.getByRole('button', { name: 'Enable' }).click();
		await expect(row.getByText('Enabled')).toBeVisible();

		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-transactions'
		);
		await page.getByRole('button', { name: 'Import', exact: true }).click();
		await page.getByRole('button', { name: 'Connected Sites' }).click();
		await expect(page.getByText(siteLabel)).toBeVisible();
	});
});
