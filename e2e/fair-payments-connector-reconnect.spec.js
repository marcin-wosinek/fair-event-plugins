import { test, expect } from '@playwright/test';
import { loginAsAdmin, wpCli } from './support/wp-cli.js';

const SETTINGS_PATH =
	'/wp-admin/admin.php?page=fair-payments-connector-settings';
const RECONCILIATION_PATH =
	'/wp-admin/admin.php?page=fair-finance-reconciliation';
const SCOPES_OPTION = 'fair_payment_mollie_scopes';
const BASE_SCOPE =
	'payments.read payments.write refunds.read refunds.write organizations.read profiles.read profiles.write balances.read';
const MISSING_ACCESS =
	'Mollie has not authorized this site to read settlements yet';

/**
 * Stand in for the OAuth platform and Mollie: answer the authorization
 * request by sending the browser back to the site with `returnParams`,
 * echoing the site's own state. Resolves with the intercepted request URL.
 *
 * @param {import('@playwright/test').Page} page         Playwright page.
 * @param {Object}                          returnParams Query parameters for the return URL.
 * @return {Promise<URL>} The authorization request the site made.
 */
function mockAuthorization(page, returnParams) {
	return new Promise((resolve) => {
		page.route(
			'https://fair-event-plugins.com/oauth/authorize**',
			(route) => {
				const requested = new URL(route.request().url());
				const back = new URL(requested.searchParams.get('return_url'));
				for (const [key, value] of Object.entries(returnParams)) {
					back.searchParams.set(key, value);
				}
				back.searchParams.set(
					'state',
					requested.searchParams.get('state')
				);
				resolve(requested);
				return route.fulfill({
					status: 200,
					contentType: 'text/html',
					body: `<script>window.location.replace(${JSON.stringify(
						back.toString()
					)});</script>`,
				});
			}
		);
	});
}

function notice(page, text) {
	return page.locator('.components-notice__content', { hasText: text });
}

test.describe('Reconnecting Mollie for settlement access (#1693)', () => {
	let savedScopes;

	test.beforeAll(() => {
		savedScopes = wpCli(`option get ${SCOPES_OPTION} --format=json`, {
			allowFailure: true,
		}).trim();
	});

	test.afterAll(() => {
		if (savedScopes) {
			wpCli(
				`option update ${SCOPES_OPTION} '${savedScopes}' --format=json`
			);
		} else {
			wpCli(`option delete ${SCOPES_OPTION}`, { allowFailure: true });
		}
	});

	test('Fair Finance points a connection without settlement access to the reconnect', async ({
		page,
	}) => {
		// A connection made before permissions were recorded.
		wpCli(`option delete ${SCOPES_OPTION}`, { allowFailure: true });
		await loginAsAdmin(page);

		await page.goto(RECONCILIATION_PATH);
		await expect(notice(page, MISSING_ACCESS)).toBeVisible();
		// Reconciliation itself stays available.
		await expect(
			page.getByRole('button', { name: 'Import settlement CSV' })
		).toBeEnabled();

		await page
			.getByRole('link', { name: 'Open Mollie connection settings' })
			.click();
		await expect(page).toHaveURL(
			new RegExp('page=fair-payments-connector-settings')
		);
		await expect(notice(page, MISSING_ACCESS)).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Reconnect to Mollie' })
		).toBeVisible();
	});

	test('a completed reconnect records the granted permission', async ({
		page,
	}) => {
		wpCli(`option delete ${SCOPES_OPTION}`, { allowFailure: true });
		await loginAsAdmin(page);
		await page.goto(SETTINGS_PATH);
		await expect(notice(page, MISSING_ACCESS)).toBeVisible();

		const authorization = mockAuthorization(page, {
			mollie_access_token: 'access_e2e_reconnected',
			mollie_refresh_token: 'refresh_e2e_reconnected',
			mollie_expires_in: '3600',
			mollie_organization_id: 'org_e2e_1693',
			mollie_profile_id: 'pfl_e2e0000000',
			mollie_test_mode: '1',
			mollie_scope: `${BASE_SCOPE} settlements.read`,
		});
		await page.getByRole('button', { name: 'Reconnect to Mollie' }).click();

		// With Fair Finance active the site asks for settlement access, as a
		// flag rather than a scope list.
		const requested = await authorization;
		expect(requested.searchParams.get('settlement_access')).toBe('1');
		expect(requested.searchParams.has('scope')).toBe(false);

		await expect(
			notice(page, 'Successfully connected to Mollie!')
		).toBeVisible();
		await expect(
			page.getByText('Settlement access: authorized')
		).toBeVisible();
		await expect(notice(page, MISSING_ACCESS)).toHaveCount(0);
		// Tokens are gone from the address bar.
		expect(new URL(page.url()).search).toBe(
			'?page=fair-payments-connector-settings'
		);

		// Fair Finance no longer asks for a reconnect.
		await page.goto(RECONCILIATION_PATH);
		await expect(
			page.getByRole('button', { name: 'Import settlement CSV' })
		).toBeVisible();
		await expect(notice(page, MISSING_ACCESS)).toHaveCount(0);
	});

	test('a cancelled reconnect keeps the existing connection and its permissions', async ({
		page,
	}) => {
		const granted = JSON.stringify([
			...BASE_SCOPE.split(' '),
			'settlements.read',
		]);
		wpCli(`option update ${SCOPES_OPTION} '${granted}' --format=json`);
		await loginAsAdmin(page);
		await page.goto(SETTINGS_PATH);
		await expect(
			page.getByText('Settlement access: authorized')
		).toBeVisible();

		const authorization = mockAuthorization(page, {
			error: 'access_denied',
			error_description: 'The resource owner denied the request',
		});
		await page
			.getByRole('button', { name: 'Reconnect', exact: true })
			.click();
		await authorization;

		await expect(
			notice(
				page,
				'Authorization cancelled. Nothing was changed, so an existing Mollie connection keeps working.'
			)
		).toBeVisible();
		expect(new URL(page.url()).search).toBe(
			'?page=fair-payments-connector-settings'
		);

		// The connection is still there and still has settlement access.
		await expect(notice(page, 'Connected to Mollie')).toBeVisible();
		await expect(
			page.getByText('Settlement access: authorized')
		).toBeVisible();
		expect(
			JSON.parse(wpCli(`option get ${SCOPES_OPTION} --format=json`))
		).toEqual(JSON.parse(granted));
	});
});
