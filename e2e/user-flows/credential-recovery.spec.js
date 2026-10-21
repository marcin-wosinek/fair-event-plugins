/**
 * E2E: an administrator recovers Instagram and Telegram credentials that the
 * site can no longer read (#1319).
 *
 * Both tokens are stored encrypted. Encrypted under another site's security
 * keys, they cannot be decrypted: the settings screens explain why, and
 * entering a new token restores the integration. With encryption support
 * switched off, the screens explain the temporary outage instead.
 *
 * The tokens are seeded raw through fair-e2e-protected-credentials.php,
 * which also reads them back. Instagram and Telegram are never called.
 */

import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USER, loginAsAdmin } from '../support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const CONTROL = '/wp-json/fair-e2e/v1/protected-credentials';
const SETTINGS = '/wp-json/wp/v2/settings';
const ENVELOPE = /^fes-enc:v1:/;

const control = async (request, data) => {
	const res = await request.post(CONTROL, { headers: adminHeaders, data });
	expect(res.ok(), await res.text()).toBeTruthy();
	return res.json();
};

const stored = async (request) => {
	const res = await request.get(CONTROL, { headers: adminHeaders });
	expect(res.ok(), await res.text()).toBeTruthy();
	return res.json();
};

// A connected Instagram account, as the settings screen saves it.
const connectInstagram = (request) =>
	request.post(SETTINGS, {
		headers: adminHeaders,
		data: {
			fair_audience_instagram_user_id: '17840000000000001',
			fair_audience_instagram_username: 'e2e_demo_account',
			fair_audience_instagram_connected: true,
		},
	});

test.describe('Recovering unreadable credentials', () => {
	let savedRoutes;

	test.beforeAll(async ({ request }) => {
		const settings = await (
			await request.get(SETTINGS, { headers: adminHeaders })
		).json();
		savedRoutes = settings.fair_payment_notification_routes;
	});

	test.afterEach(async ({ request }) => {
		await control(request, { supported: true });
	});

	test.afterAll(async ({ request }) => {
		await control(request, {
			supported: true,
			telegram: { delete: true },
		});
		await request.post(SETTINGS, {
			headers: adminHeaders,
			data: {
				fair_audience_instagram_access_token: '',
				fair_audience_instagram_user_id: '',
				fair_audience_instagram_username: '',
				fair_audience_instagram_token_expires: 0,
				fair_audience_instagram_connected: false,
				fair_payment_notification_routes: savedRoutes,
			},
		});
	});

	test('Instagram asks for reconnection and accepts a new access token', async ({
		page,
		request,
	}) => {
		await connectInstagram(request);
		await control(request, {
			instagram: { foreign_key: 'instagram_e2e_foreign' },
		});

		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-audience-settings');

		const notice = page.locator('.components-notice.is-error');
		await expect(notice).toContainText(
			'Instagram needs to be reconnected: the stored access token can no longer be read.'
		);
		await expect(page.getByText('Connected to Instagram')).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Connect with Instagram' })
		).toBeVisible();

		await page.getByLabel('Access Token').fill('instagram_e2e_reentered');
		await page.getByRole('button', { name: 'Save Token' }).click();

		await expect(
			page.locator('.components-notice.is-success', {
				hasText: 'Connected to Instagram',
			})
		).toBeVisible();
		await expect(notice).toHaveCount(0);

		const after = await stored(request);
		expect(after.instagram).toMatch(ENVELOPE);
		expect(after.instagram_decrypted).toBe('instagram_e2e_reentered');
	});

	test('Instagram explains a temporary encryption outage', async ({
		page,
		request,
	}) => {
		await connectInstagram(request);
		await control(request, {
			instagram: { token: 'instagram_e2e_paused' },
			supported: false,
		});

		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-audience-settings');

		await expect(
			page.locator('.components-notice.is-warning')
		).toContainText(
			'Instagram is paused: the access token is stored encrypted'
		);
		await expect(page.getByText('@e2e_demo_account')).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Save Token' })
		).toHaveCount(0);
	});

	test('Telegram keeps an unreadable token through unrelated saves and accepts it re-entered', async ({
		page,
		request,
	}) => {
		const { telegram: envelope } = await control(request, {
			telegram: { foreign_key: '1319:telegram_foreign' },
		});

		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-notifications'
		);

		const notice = page.locator('.components-notice.is-error');
		await expect(notice).toContainText(
			'Telegram notifications are paused: the stored bot token can no longer be read.'
		);
		const token = page.getByLabel('Bot token');
		await expect(token).toHaveValue('');

		// Saving the routes leaves the unreadable token in place.
		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(
			page.locator('.components-notice.is-success', {
				hasText: 'Notification settings saved.',
			})
		).toBeVisible();
		expect((await stored(request)).telegram).toBe(envelope);

		await token.fill('1319:telegram_reentered');
		await page.getByRole('button', { name: 'Save settings' }).click();
		await expect(notice).toHaveCount(0);

		const after = await stored(request);
		expect(after.telegram).toMatch(ENVELOPE);
		expect(after.telegram_decrypted).toBe('1319:telegram_reentered');

		// The screen reads the decrypted token back after a reload.
		await page.reload();
		await expect(page.getByLabel('Bot token')).toHaveValue(
			'1319:telegram_reentered'
		);
	});

	test('Telegram explains a temporary encryption outage', async ({
		page,
		request,
	}) => {
		await control(request, {
			telegram: { token: '1319:telegram_paused' },
			supported: false,
		});

		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-notifications'
		);

		await expect(
			page.locator('.components-notice.is-warning')
		).toContainText(
			'Telegram notifications are paused: the bot token is stored encrypted'
		);
	});
});
