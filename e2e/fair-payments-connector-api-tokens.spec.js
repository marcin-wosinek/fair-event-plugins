/**
 * API Tokens as a tab of Fair Payments Connector's Settings page (#1747).
 *
 * Covers the token-management flow with only Fair Payments Connector active,
 * and that an updated Fair Payments Connector Experimental adds no second
 * place to manage tokens.
 *
 * Run: `npm run test:e2e:local -- e2e/fair-payments-connector-api-tokens.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, wpCli } from './support/wp-cli.js';

const EXPERIMENTAL = 'fair-payments-connector-experimental';
const SETTINGS = '/wp-admin/admin.php?page=fair-payments-connector-settings';
const TOKENS_PATH = 'fair-payments-connector/v1/admin/api-tokens';
const LABEL = `e2e-tokens-1747-${Date.now()}.example.test`;

async function openApiTokensTab(page) {
	await page.goto(SETTINGS);
	await page.getByRole('tab', { name: 'API Tokens' }).click();
	await expect(
		page.getByRole('heading', { level: 2, name: 'API Tokens' })
	).toBeVisible();
}

test.describe('API Tokens settings tab (#1747)', () => {
	let experimentalWasActive;

	const setExperimental = (active) =>
		wpCli(`plugin ${active ? 'activate' : 'deactivate'} ${EXPERIMENTAL}`);

	test.beforeAll(() => {
		experimentalWasActive =
			wpCli(`plugin list --name=${EXPERIMENTAL} --field=status`, {
				allowFailure: true,
			}).trim() === 'active';
	});

	test.afterAll(() => {
		setExperimental(experimentalWasActive);
	});

	test('creates, shows once, lists and revokes a token without the experimental plugin', async ({
		page,
	}) => {
		setExperimental(false);
		await loginAsAdmin(page);
		await openApiTokensTab(page);

		await page.getByRole('button', { name: 'Generate token' }).click();
		const form = page.getByRole('dialog', { name: 'Generate API token' });
		await expect(form).toBeVisible();

		// Only the transactions scope is offered, and a label is required.
		await expect(form.getByRole('checkbox')).toHaveCount(1);
		await expect(
			form.getByRole('checkbox', { name: 'Read transactions' })
		).toBeChecked();
		await expect(
			form.getByRole('button', { name: 'Generate token' })
		).toBeDisabled();
		await expect(
			form.getByText('Enter a label to generate the token.')
		).toBeVisible();

		await form.getByLabel('Label').fill(LABEL);
		await form.getByRole('button', { name: 'Generate token' }).click();

		const created = page.getByRole('dialog', { name: 'Token created' });
		await expect(created).toBeVisible();
		const plaintext = (await created.locator('code').innerText()).trim();
		expect(plaintext).toMatch(/^[A-Za-z0-9]{40}$/);

		// The token works against the data sharing API.
		const me = await page.request.get(
			'/wp-json/fair-payments-connector/v1/external/me',
			{ headers: { Authorization: `Bearer ${plaintext}` } }
		);
		expect(me.status()).toBe(200);
		expect((await me.json()).label).toBe(LABEL);

		await created.getByRole('button', { name: 'Done' }).click();
		await expect(page.getByRole('dialog')).toHaveCount(0);

		// Listed, and the plaintext is gone for good — also after a reload.
		const row = page.locator('tr', { hasText: LABEL });
		await expect(row).toContainText('transactions:read');
		await expect(row).toContainText('Active');
		await expect(page.locator('body')).not.toContainText(plaintext);

		await openApiTokensTab(page);
		await expect(row).toBeVisible();
		await expect(page.locator('body')).not.toContainText(plaintext);

		// Revoking names the token and what stops working.
		await row.getByRole('button', { name: 'Revoke' }).click();
		const confirm = page.getByRole('dialog', { name: 'Revoke API token' });
		await expect(confirm).toContainText(`Revoke the API token "${LABEL}"?`);
		await expect(confirm).toContainText(
			"Every site connected with it loses access to this site's transactions immediately."
		);
		await confirm.getByRole('button', { name: 'Revoke token' }).click();

		await expect(
			page.getByText(`API token "${LABEL}" revoked.`).first()
		).toBeVisible();
		await expect(row).toContainText('Revoked');
		await expect(row.getByRole('button', { name: 'Revoke' })).toHaveCount(
			0
		);

		const rejected = await page.request.get(
			'/wp-json/fair-payments-connector/v1/external/me',
			{ headers: { Authorization: `Bearer ${plaintext}` } }
		);
		expect(rejected.status()).toBe(401);
	});

	test('stays usable on a phone-sized screen', async ({ page }) => {
		setExperimental(false);
		await page.setViewportSize({ width: 375, height: 812 });
		await loginAsAdmin(page);
		await openApiTokensTab(page);

		// Every tab stays reachable and nothing scrolls sideways.
		for (const name of [
			'Connection',
			'Payment Methods',
			'Currency',
			'Audit Log',
			'API Tokens',
		]) {
			await expect(page.getByRole('tab', { name })).toBeInViewport();
		}
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth - window.innerWidth
			)
		).toBeLessThanOrEqual(0);

		await page.getByRole('button', { name: 'Generate token' }).click();
		const form = page.getByRole('dialog', { name: 'Generate API token' });
		await expect(form.getByLabel('Label')).toBeInViewport();
		await expect(
			form.getByRole('button', { name: 'Generate token' })
		).toBeInViewport();
		await expect(
			form.getByRole('button', { name: 'Cancel' })
		).toBeInViewport();
	});

	test('with the experimental plugin active there is one place to manage tokens', async ({
		page,
	}) => {
		setExperimental(true);
		await loginAsAdmin(page);
		await page.goto('/wp-admin/');

		const menu = page.locator(
			'#toplevel_page_fair-payments-connector-transactions'
		);
		await expect(menu).toBeVisible();
		// Connected Sites stays; the standalone API Tokens page is gone.
		await expect(
			menu.locator(
				'a[href*="page=fair-payments-connector-connected-sites"]'
			)
		).toBeAttached();
		await expect(
			menu.locator('a[href*="page=fair-payments-connector-api-tokens"]')
		).toHaveCount(0);

		// The tab is there and its list loads from the token routes.
		const listed = page.waitForResponse(
			(response) =>
				response.url().includes(TOKENS_PATH) &&
				response.request().method() === 'GET'
		);
		await openApiTokensTab(page);
		expect((await listed).status()).toBe(200);

		// Connected Sites still mounts.
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-connected-sites'
		);
		await expect(
			page.locator('#fair-payments-connector-connected-sites-root > *')
		).not.toHaveCount(0);
	});
});
