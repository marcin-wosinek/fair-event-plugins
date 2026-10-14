import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

/*
 * Fair Payments Connector confirmations (#1773): the live test payment,
 * Mollie disconnection, and transaction deletion dialogs identify what they
 * act on. Every request that would create a payment, disconnect, or delete
 * is intercepted with a fake answer — nothing reaches Mollie and no stored
 * state changes.
 */

const SETTINGS_PATH =
	'/wp-admin/admin.php?page=fair-payments-connector-settings';
const FAKE_TRANSACTION_ID = 987654;
const TRANSACTION_PATH = `/wp-admin/admin.php?page=fair-payments-connector-transaction&transaction_id=${FAKE_TRANSACTION_ID}`;
const CHECKOUT_URL = 'https://www.mollie.com/checkout/e2e-fake-1773';

const LIVE_CONTEXT = {
	amount: '1.00',
	amount_display: '1.00 PLN',
	currency: 'PLN',
	mode: 'live',
	profile_id: 'pfl_e2e0000000',
	organization_id: 'org_e2e_1773',
};

/**
 * Route REST requests whose (decoded) URL contains `fragment`, whatever the
 * permalink structure.
 *
 * @param {import('@playwright/test').Page} page     Playwright page.
 * @param {string}                          fragment REST route fragment.
 * @param {Function}                        handler  Route handler.
 */
function routeRest(page, fragment, handler) {
	return page.route(
		(url) => decodeURIComponent(url.href).includes(fragment),
		handler
	);
}

/**
 * The REST method of a request; apiFetch sends DELETE as a POST with an
 * override header.
 *
 * @param {import('@playwright/test').Request} request Intercepted request.
 * @return {string} HTTP method
 */
const methodOf = (request) =>
	request.headers()['x-http-method-override'] || request.method();

const json = (route, body, status = 200) =>
	route.fulfill({
		status,
		contentType: 'application/json',
		body: JSON.stringify(body),
	});

/**
 * Present the connected fake account as a live-mode site with a known
 * profile name, without changing the stored settings.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 */
async function fakeLiveConnection(page) {
	await routeRest(page, 'wp/v2/settings', async (route) => {
		if (route.request().method() !== 'GET') {
			return route.continue();
		}
		const response = await route.fetch();
		return json(route, {
			...(await response.json()),
			fair_payment_mollie_connected: true,
			fair_payment_mode: 'live',
			fair_payment_organization_id: LIVE_CONTEXT.organization_id,
			fair_payment_mollie_profile_id: LIVE_CONTEXT.profile_id,
		});
	});
	await routeRest(
		page,
		'fair-payments-connector/v1/connection/overview',
		(route) =>
			json(route, {
				profile_name: 'E2E Festival Shop',
				profile_id: LIVE_CONTEXT.profile_id,
				mode: 'live',
				methods: [],
				manage_url: 'https://my.mollie.com/dashboard/',
			})
	);
}

test.describe('Fair Payments Connector confirmations (#1773)', () => {
	test.beforeEach(async ({ page }) => {
		await loginAsAdmin(page);
	});

	test('a live test payment is confirmed with its amount and account, and cancelling creates nothing', async ({
		page,
	}) => {
		await fakeLiveConnection(page);
		const created = [];
		await routeRest(
			page,
			'fair-payments-connector/v1/test-payment',
			(route) => {
				if (route.request().method() === 'GET') {
					return json(route, LIVE_CONTEXT);
				}
				created.push(route.request().postDataJSON());
				return json(
					route,
					{
						success: true,
						transaction_id: 1,
						checkout_url: CHECKOUT_URL,
						status: 'open',
						currency: 'PLN',
						mode: 'live',
					},
					201
				);
			}
		);
		// The checkout would open in a new tab; keep it in this test.
		await page.addInitScript(() => {
			window.open = () => null;
		});

		await page.goto(SETTINGS_PATH);
		await expect(page.getByText('E2E Festival Shop')).toBeVisible();

		await page.getByRole('button', { name: 'Create test payment' }).click();
		const dialog = page.getByRole('dialog');
		await expect(
			dialog.getByText('Create a live test payment of 1.00 PLN?')
		).toBeVisible();
		await expect(dialog.getByText('E2E Festival Shop')).toBeVisible();
		await expect(dialog.getByText(LIVE_CONTEXT.profile_id)).toBeVisible();
		await expect(
			dialog.getByText(LIVE_CONTEXT.organization_id)
		).toBeVisible();
		await expect(
			dialog.getByText(/real payment with real money and gateway fees/)
		).toBeVisible();

		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toHaveCount(0);
		expect(created).toHaveLength(0);

		await page.getByRole('button', { name: 'Create test payment' }).click();
		await page
			.getByRole('dialog')
			.getByRole('button', { name: 'Create live test payment' })
			.click();

		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(
			page.getByRole('link', { name: 'open it here.' })
		).toHaveAttribute('href', CHECKOUT_URL);
		expect(created).toEqual([
			{
				confirmed: {
					mode: 'live',
					currency: 'PLN',
					profile_id: LIVE_CONTEXT.profile_id,
					organization_id: LIVE_CONTEXT.organization_id,
				},
			},
		]);
	});

	test('disconnecting names the Mollie account and keeps a failure in the dialog', async ({
		page,
	}) => {
		await fakeLiveConnection(page);
		let attempts = 0;
		await routeRest(
			page,
			'fair-payments-connector/v1/oauth/disconnect',
			(route) => {
				attempts++;
				return json(
					route,
					{
						code: 'e2e_failure',
						message: 'Mollie connection could not be removed.',
						data: { status: 500 },
					},
					500
				);
			}
		);

		await page.goto(SETTINGS_PATH);
		await expect(page.getByText('E2E Festival Shop')).toBeVisible();

		await page.getByRole('button', { name: 'Disconnect Mollie' }).click();
		const dialog = page.getByRole('dialog');
		await expect(
			dialog.getByText(
				'Disconnect this site from the Mollie profile "E2E Festival Shop"?'
			)
		).toBeVisible();
		await expect(
			dialog.getByText(
				/Payments already in Mollie are not cancelled or refunded/
			)
		).toBeVisible();

		await dialog.getByRole('button', { name: 'Disconnect Mollie' }).click();
		await expect(
			dialog.getByText('Mollie connection could not be removed.')
		).toBeVisible();
		await expect(
			dialog.getByRole('button', { name: 'Disconnect Mollie' })
		).toBeEnabled();
		expect(attempts).toBe(1);
	});

	test('deleting a transaction names it and keeps a failure in the dialog', async ({
		page,
	}) => {
		await routeRest(
			page,
			`fair-payments-connector/v1/transactions/${FAKE_TRANSACTION_ID}/log`,
			(route) => json(route, [])
		);
		const deletions = [];
		await routeRest(
			page,
			`fair-payments-connector/v1/transactions/${FAKE_TRANSACTION_ID}`,
			(route) => {
				if (route.request().url().includes('/log')) {
					return route.fallback();
				}
				if (methodOf(route.request()) === 'DELETE') {
					deletions.push(route.request().url());
					return json(
						route,
						{
							code: 'e2e_failure',
							message: 'The transaction could not be deleted.',
							data: { status: 500 },
						},
						500
					);
				}
				return json(route, {
					id: FAKE_TRANSACTION_ID,
					mollie_payment_id: 'tr_e2e_1773',
					post_id: null,
					post_title: '',
					user_id: null,
					user_name: '',
					participant_id: null,
					participant: null,
					amount: 25,
					currency: 'EUR',
					mollie_fee: null,
					application_fee: null,
					status: 'paid',
					testmode: true,
					description: 'Summer Jam ticket',
					redirect_url: '',
					webhook_url: '',
					checkout_url: '',
					metadata: null,
					created_at: '2026-07-01 10:00:00',
					payment_initiated_at: '',
					updated_at: '2026-07-01 10:00:00',
					line_items: [],
					event_date_id: null,
					event: null,
				});
			}
		);

		await page.goto(TRANSACTION_PATH);
		await page
			.getByRole('button', { name: 'Delete local transaction' })
			.click();

		const dialog = page.getByRole('dialog');
		await expect(
			dialog.getByText(
				`Permanently delete transaction #${FAKE_TRANSACTION_ID} for 25.00 EUR? This cannot be undone.`
			)
		).toBeVisible();
		await expect(
			dialog.getByText('Description: Summer Jam ticket')
		).toBeVisible();
		await expect(
			dialog.getByText(/not cancelled, refunded, or deleted/)
		).toBeVisible();

		await dialog
			.getByRole('button', { name: 'Delete local transaction' })
			.click();
		await expect(
			dialog.getByText('The transaction could not be deleted.')
		).toBeVisible();
		expect(deletions).toHaveLength(1);
	});
});
