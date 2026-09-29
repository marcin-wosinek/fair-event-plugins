/**
 * Experimental settings live in a tab of Fair Events Settings (#1676).
 *
 * Covers the tab's availability (only while fair-events-experimental is
 * active), bookmark/reload selection via `?tab=experimental`, the retired
 * standalone menu entry and its redirect, saving a feature toggle, and the
 * `manage_options` restriction.
 *
 * Run: `npm run test:e2e -- e2e/fair-events-experimental-settings-tab.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';

const SETTINGS_URL = '/wp-admin/admin.php?page=fair-events-settings';
const TAB_URL = `${SETTINGS_URL}&tab=experimental`;
const LEGACY_URL = '/wp-admin/admin.php?page=fair-events-experimental-settings';
const EDITOR = { login: 'e2e_settings_editor', password: 'e2e-editor-pass' };

function storedFeatures() {
	const out = wpCli(
		'option get fair_events_experimental_features --format=json',
		{ allowFailure: true }
	).trim();
	return out ? JSON.parse(out) : {};
}

test.describe('Experimental settings tab', () => {
	test.beforeEach(() => {
		wpCli('option delete fair_events_experimental_features', {
			allowFailure: true,
		});
	});

	test.afterAll(() => {
		wpCli('plugin activate fair-events-experimental', {
			allowFailure: true,
		});
		wpCli('option delete fair_events_experimental_features', {
			allowFailure: true,
		});
		wpCli(`user delete ${EDITOR.login} --yes`, { allowFailure: true });
	});

	test('the menu has no separate Experimental entry', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto(SETTINGS_URL);

		const menu = page.locator('#adminmenu');
		await expect(
			menu.locator('a[href$="page=fair-events-settings"]')
		).toBeVisible();
		await expect(
			menu.locator('a[href*="page=fair-events-experimental-settings"]')
		).toHaveCount(0);
	});

	test('the former settings URL redirects to the Experimental tab', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(LEGACY_URL);

		await expect(page).toHaveURL(
			/page=fair-events-settings&tab=experimental/
		);
		await expect(
			page.getByRole('tab', { name: 'Experimental', selected: true })
		).toBeVisible();
	});

	test('selecting the tab survives a reload', async ({ page }) => {
		await loginAsAdmin(page);
		await page.goto(SETTINGS_URL);

		await page.getByRole('tab', { name: 'Experimental' }).click();
		await expect(page).toHaveURL(/tab=experimental/);
		await expect(
			page.getByRole('heading', { name: 'Feature Bundles' })
		).toBeVisible();

		await page.reload();
		await expect(
			page.getByRole('tab', { name: 'Experimental', selected: true })
		).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'Feature Bundles' })
		).toBeVisible();
	});

	test('saving a feature toggle persists it', async ({ page }) => {
		wpCli(
			`option update fair_events_experimental_features '{"mailings":false}' --format=json`
		);
		await loginAsAdmin(page);
		await page.goto(TAB_URL);

		const mailings = page.getByRole('checkbox', {
			name: 'Mailings',
			exact: true,
		});
		await expect(mailings).not.toBeChecked();
		await mailings.check();
		await page.getByRole('button', { name: 'Save Features' }).click();
		await expect(
			page.getByText('Features saved.', { exact: false }).first()
		).toBeVisible();

		expect(storedFeatures().mailings).toBe(true);

		await page.reload();
		await expect(
			page.getByRole('checkbox', { name: 'Mailings', exact: true })
		).toBeChecked();
	});

	test('conditional cards follow their feature bundles', async ({ page }) => {
		wpCli(
			`option update fair_events_experimental_features '{"sources":true,"meta-conversions":false}' --format=json`
		);
		await loginAsAdmin(page);
		await page.goto(TAB_URL);

		await expect(
			page.getByRole('heading', { name: 'Weekly notifications' })
		).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'Meta Conversions' })
		).toHaveCount(0);
	});

	test('non-administrators cannot open the tab or the former URL', async ({
		page,
	}) => {
		wpCli(`user delete ${EDITOR.login} --yes`, { allowFailure: true });
		wpCli(
			`user create ${EDITOR.login} ${EDITOR.login}@example.com --role=editor --user_pass=${EDITOR.password}`
		);

		await page.goto('/wp-login.php');
		await page.fill('#user_login', EDITOR.login);
		await page.fill('#user_pass', EDITOR.password);
		await page.click('#wp-submit');
		await page.waitForURL(/\/wp-admin\/?/);

		for (const url of [TAB_URL, LEGACY_URL]) {
			await page.goto(url);
			await expect(
				page.getByText(
					'Sorry, you are not allowed to access this page.'
				)
			).toBeVisible();
			await expect(
				page.getByRole('heading', { name: 'Feature Bundles' })
			).toHaveCount(0);
		}
	});

	test('without the Experimental plugin the other tabs still work', async ({
		page,
	}) => {
		wpCli('plugin deactivate fair-events-experimental');
		try {
			await loginAsAdmin(page);
			await page.goto(TAB_URL);

			await expect(
				page.getByRole('tab', { name: 'General', selected: true })
			).toBeVisible();
			await expect(
				page.getByRole('tab', { name: 'Experimental' })
			).toHaveCount(0);

			await page.getByRole('tab', { name: 'Features' }).click();
			await expect(page).toHaveURL(/tab=features/);
		} finally {
			wpCli('plugin activate fair-events-experimental');
		}
	});
});
