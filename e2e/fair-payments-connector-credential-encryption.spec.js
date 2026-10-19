import { test, expect, request } from '@playwright/test';
import { ADMIN_USER, ADMIN_PASSWORD, loginAsAdmin } from './support/wp-cli.js';

/*
 * Encrypted Mollie credentials (#1318): when the stored tokens cannot be
 * read, the connection settings explain why and pause the actions that need
 * them, and a visitor sees that online payment is temporarily unavailable.
 * e2e/mu-plugins/fair-e2e-mollie-credentials.php switches the connector to
 * its stored tokens and toggles encryption support.
 */

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8889';
const SETTINGS_PATH =
	'/wp-admin/admin.php?page=fair-payments-connector-settings';
const CONTROL = '/wp-json/fair-e2e/v1/mollie-credentials';
const SUPPORT_LOST =
	'Payments are paused: the Mollie connection is stored encrypted';
const UNRECOVERABLE =
	'Payments are paused: the stored Mollie connection can no longer be read';
const VISITOR_MESSAGE = 'Online payment is temporarily unavailable.';

function notice(page, text) {
	return page.locator('.components-notice__content', { hasText: text });
}

test.describe('Encrypted Mollie credentials (#1318)', () => {
	test.describe.configure({ mode: 'serial' });

	let api;
	let paymentPage;

	async function control(data) {
		const res = await api.post(CONTROL, { data });
		expect(res.status(), await res.text()).toBe(200);
		return res.json();
	}

	test.beforeAll(async () => {
		api = await request.newContext({
			baseURL: BASE_URL,
			extraHTTPHeaders: {
				Authorization:
					'Basic ' +
					Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
						'base64'
					),
			},
		});
		paymentPage = await control({
			stored: true,
			supported: true,
			tokens: {
				access_token: 'access_e2e_ui',
				refresh_token: 'refresh_e2e_ui',
			},
			expires: 3600,
			payment_page: true,
		});
	});

	test.afterAll(async () => {
		await control({
			stored: false,
			supported: true,
			delete_page: paymentPage.page_id,
		});
		await api.dispose();
	});

	test('lost encryption support pauses payments until it is restored', async ({
		page,
	}) => {
		await control({ supported: false });
		await loginAsAdmin(page);
		await page.goto(SETTINGS_PATH);

		await expect(notice(page, SUPPORT_LOST)).toBeVisible();
		await expect(notice(page, 'Connected to Mollie')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Create test payment' })
		).toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'Reconnect', exact: true })
		).toBeDisabled();
		await expect(
			page.getByRole('button', { name: 'Disconnect Mollie' })
		).toBeEnabled();

		await page.goto(paymentPage.page_url);
		await expect(page.getByText(VISITOR_MESSAGE)).toBeVisible();
		await expect(page.getByRole('button', { name: 'Pay Now' })).toHaveCount(
			0
		);

		await control({ supported: true });

		await page.goto(SETTINGS_PATH);
		await expect(notice(page, 'Connected to Mollie')).toBeVisible();
		await expect(notice(page, SUPPORT_LOST)).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Create test payment' })
		).toBeEnabled();

		await page.goto(paymentPage.page_url);
		await expect(
			page.getByRole('button', { name: 'Pay Now' })
		).toBeVisible();
	});

	test('an unreadable connection offers a reconnect', async ({ page }) => {
		await control({ foreign_key: true });
		await loginAsAdmin(page);
		await page.goto(SETTINGS_PATH);

		const unreadable = page.locator('.components-notice', {
			hasText: UNRECOVERABLE,
		});
		await expect(unreadable).toBeVisible();
		await expect(
			unreadable.getByRole('button', { name: 'Reconnect to Mollie' })
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Create test payment' })
		).toBeDisabled();
	});
});
