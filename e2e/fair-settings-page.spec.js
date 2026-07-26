/**
 * Central "Fair Event Plugins" settings screen (#1200).
 *
 * A single shared screen, registered by `FairEventsShared\Admin\SettingsPage`
 * and booted from every active Fair plugin's Core\Plugin::init(), lists one
 * bundled-translations row per supporting plugin. This suite covers the
 * cross-plugin behaviour that can't be unit-tested: exactly one menu entry
 * with several plugins active, a real save round-trip against a plugin's
 * option, a row disappearing when its plugin is deactivated, and a
 * wp-config-forced value staying locked even against a forged POST.
 *
 * Scoped to the plugins the wp-env `tests` instance actually mounts
 * (.wp-env.json): fair-events, fair-audience, fair-payments-connector,
 * fair-form, fair-platform each get a row. fair-timetable and
 * fair-payments-connector-experimental aren't part of this harness.
 * fair-events-experimental / fair-audience-experimental never get a row —
 * they always bundle translations (see I18N_SETUP.md).
 *
 * Run: `npm run test:e2e -- fair-settings-page`.
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';

const PAGE_URL = '/wp-admin/options-general.php?page=fair-event-plugins';

/** Plugin label → its option name, for every plugin mounted in wp-env. */
const ROWS = {
	'Fair Events': 'fair_events_features',
	'Fair Audience': 'fair_audience_features',
	'Fair Payments Connector': 'fair_payment_features',
	'Fair Form': 'fair_form_features',
	'Fair Platform': 'fair_platform_features',
};

function getOptionJson(name) {
	const out = wpCli(`option get ${name} --format=json`, {
		allowFailure: true,
	}).trim();
	if (!out) {
		return null;
	}
	try {
		return JSON.parse(out);
	} catch {
		return null;
	}
}

test.describe('Fair Event Plugins — central settings screen', () => {
	// The tests-cli instance only activates fair-events, fair-audience and
	// fair-form by default. Bring the other two supporting plugins in for
	// this suite so "several plugins active" is actually exercised, then
	// restore the baseline so other suites aren't affected.
	test.beforeAll(() => {
		wpCli('plugin activate fair-payments-connector fair-platform');
	});

	test.afterAll(() => {
		wpCli('plugin deactivate fair-payments-connector fair-platform');
	});

	test.afterEach(() => {
		wpCli('option delete fair_e2e_force_form_bundled_translations', {
			allowFailure: true,
		});
	});

	test('exactly one Settings menu entry, with a row per supporting active plugin', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/options-general.php');

		await expect(
			page.locator(
				'#menu-settings a[href="options-general.php?page=fair-event-plugins"]'
			),
			'expected exactly one central Fair Event Plugins menu entry'
		).toHaveCount(1);

		await page.goto(PAGE_URL);
		await expect(
			page.getByRole('heading', { name: 'Fair Event Plugins' })
		).toBeVisible();

		for (const label of Object.keys(ROWS)) {
			await expect(
				page.locator('th', { hasText: label }),
				`expected a row for ${label}`
			).toBeVisible();
		}
	});

	test('toggling a row flips that plugin option', async ({ page }) => {
		wpCli('option delete fair_form_features', { allowFailure: true });

		await loginAsAdmin(page);
		await page.goto(PAGE_URL);

		const row = page.locator('tr').filter({ hasText: 'Fair Form' });
		await row.locator('input[type="checkbox"]').check();
		await page
			.locator('form')
			.getByRole('button', { name: 'Save Changes' })
			.click();

		await expect(page.getByText('Settings saved.')).toBeVisible();

		const stored = getOptionJson('fair_form_features');
		expect(stored?.['bundled-translations']).toBe(true);

		wpCli('option delete fair_form_features', { allowFailure: true });
	});

	test('deactivating a plugin removes its row and leaves the page working for the rest', async ({
		page,
	}) => {
		wpCli('plugin deactivate fair-form');
		try {
			await loginAsAdmin(page);
			await page.goto(PAGE_URL);

			await expect(
				page.locator('th', { hasText: 'Fair Form' })
			).toHaveCount(0);
			await expect(
				page.locator('th', { hasText: 'Fair Events' })
			).toBeVisible();
		} finally {
			wpCli('plugin activate fair-form');
		}
	});

	test('a value forced by a wp-config constant renders locked and survives a forged POST', async ({
		page,
	}) => {
		wpCli('option delete fair_form_features', { allowFailure: true });
		wpCli('option update fair_e2e_force_form_bundled_translations 1');

		await loginAsAdmin(page);
		await page.goto(PAGE_URL);

		const row = page.locator('tr').filter({ hasText: 'Fair Form' });
		await expect(row.locator('input[type="checkbox"]')).toBeDisabled();
		await expect(
			row.getByText('Forced by a wp-config constant')
		).toBeVisible();

		// Forge a POST that tries to write the locked field anyway, bypassing
		// the disabled checkbox a real browser would never submit.
		const nonce = await page
			.locator('input[name="fair_event_plugins_settings_nonce"]')
			.inputValue();
		const fieldIds = await page
			.locator('input[name="fair_event_plugins_fields[]"]')
			.evaluateAll((els) => els.map((el) => el.value));

		const body = new URLSearchParams();
		body.append('fair_event_plugins_settings_nonce', nonce);
		for (const id of fieldIds) {
			body.append('fair_event_plugins_fields[]', id);
		}
		body.append(
			'fair_event_plugins_values[fair-form/bundled-translations]',
			'1'
		);

		const response = await page.request.post(PAGE_URL, {
			data: body.toString(),
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		});
		expect(response.ok()).toBeTruthy();

		// The locked field must never be written, forged POST or not.
		const stored = getOptionJson('fair_form_features');
		expect(stored?.['bundled-translations']).not.toBe(true);

		wpCli('option delete fair_form_features', { allowFailure: true });
	});
});
