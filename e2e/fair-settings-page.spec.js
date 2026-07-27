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

function isPluginActive(plugin) {
	return wpCli(`plugin get ${plugin} --field=status`).trim() === 'active';
}

test.describe('Fair Event Plugins — central settings screen', () => {
	// fair-payments-connector and fair-platform are normally active
	// throughout the whole e2e run (other specs depend on that, e.g.
	// user-flows/get-tickets-purchase.spec.js needs the payments-connector
	// webhook route). Only toggle them here if they were inactive to begin
	// with, and restore that exact prior state afterwards — unconditionally
	// deactivating them in afterAll previously broke every later spec in the
	// same serial run that relies on fair-payments-connector being active.
	let payWasActive;
	let platformWasActive;

	test.beforeAll(() => {
		payWasActive = isPluginActive('fair-payments-connector');
		platformWasActive = isPluginActive('fair-platform');
		if (!payWasActive || !platformWasActive) {
			wpCli('plugin activate fair-payments-connector fair-platform');
		}
	});

	test.afterAll(() => {
		if (!payWasActive) {
			wpCli('plugin deactivate fair-payments-connector');
		}
		if (!platformWasActive) {
			wpCli('plugin deactivate fair-platform');
		}
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
		// The save round-trip re-renders the full admin page (collecting
		// fields from all 5 active plugins) after the redirect, which has
		// twice run past the default 60s budget on a loaded CI runner while
		// never failing locally — give it more headroom rather than chase a
		// non-reproducing race.
		test.slow();

		wpCli('option delete fair_form_features', { allowFailure: true });

		await loginAsAdmin(page);
		await page.goto(PAGE_URL);

		const row = page.locator('tr').filter({ hasText: 'Fair Form' });
		await row.locator('input[type="checkbox"]').check();
		// The save handler redirects back to the page with
		// settings-updated=true, so this also locks in that a plain form
		// submit doesn't leave the browser on a resubmittable POST. Assert
		// on the network response rather than the final page.url(): WP core
		// (the admin command-palette's @wordpress/router) rewrites the URL
		// via history.replaceState shortly after load, stripping
		// settings-updated — so by the time a URL assertion would poll, the
		// query arg is already gone even though the redirect did happen.
		const [redirectedResponse] = await Promise.all([
			page.waitForResponse(
				(response) =>
					response.request().method() === 'GET' &&
					/[?&]settings-updated=true\b/.test(response.url())
			),
			page
				.locator('form')
				.getByRole('button', { name: 'Save Changes' })
				.click(),
		]);
		expect(redirectedResponse.ok()).toBeTruthy();
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
