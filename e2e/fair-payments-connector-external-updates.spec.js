/**
 * External Updates (#1695): an administrator runs the Mollie and
 * connected-site imports from one page and reviews the persistent log.
 *
 * Mollie is served by lib/mollie-http-double.php and connected sites by
 * lib/connected-site-http-double.php, so no request leaves the host.
 */
import { test, expect, request } from '@playwright/test';
import {
	loginAsAdmin,
	runScript,
	wpCli,
	ADMIN_USER,
	ADMIN_PASSWORD,
} from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const SITES = '/wp-json/fair-payments-connector/v1/admin/connected-sites';

test.describe('External Updates', () => {
	let api;
	const siteIds = [];

	const createSite = async (label, host) => {
		const res = await api.post(SITES, {
			headers: adminHeaders,
			data: {
				label,
				base_url: `https://${host}.connected-site.e2e.test`,
				token: 'e2e-connected-site-token',
			},
		});
		expect(res.ok(), await res.text()).toBeTruthy();
		const site = await res.json();
		siteIds.push(site.id);
		return site;
	};

	const cleanUp = async () => {
		wpCli(
			'db query "DELETE FROM wp_fair_payment_transactions WHERE mollie_payment_id = \'tr_e2emanualimport\'"'
		);
		await api.delete(
			'/wp-json/fair-e2e/v1/external-updates/transactions?prefix=tr_e2ecs',
			{ headers: adminHeaders }
		);
	};

	test.beforeAll(async ({ baseURL }) => {
		api = await request.newContext({ baseURL });
		// A run left running by another spec would block this one.
		await api.post('/wp-json/fair-e2e/v1/external-updates/age-running', {
			headers: adminHeaders,
		});
		await cleanUp();
	});

	test.afterAll(async () => {
		for (const id of siteIds) {
			await api.delete(`${SITES}/${id}`, { headers: adminHeaders });
		}
		await cleanUp();
		await api.dispose();
	});

	test('imports from Mollie and a connected site, and keeps the log after a reload', async ({
		page,
	}) => {
		const siteLabel = `E2E shop ${Date.now()}`;
		await createSite(siteLabel, 'ok');

		await loginAsAdmin(page);
		// Clicking an admin menu link stalls rendering in headless Chromium
		// on this WordPress build (existing pages too), so check the link
		// and navigate directly.
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-external-updates'
		);
		await expect(
			page
				.locator('#adminmenu')
				.getByRole('link', { name: 'External Updates' })
		).toHaveAttribute(
			'href',
			/page=fair-payments-connector-external-updates/
		);
		await expect(
			page.getByRole('heading', { name: 'External Updates', level: 1 })
		).toBeVisible();

		// Mollie: find, select, import.
		const mollie = page.locator('.components-card', {
			hasText: 'Mollie payments',
		});
		await mollie.getByRole('button', { name: 'Find payments' }).click();
		await mollie.getByLabel('E2E manual Mollie payment').check();
		await mollie
			.getByRole('button', { name: 'Import selected payments' })
			.click();
		await expect(
			mollie.locator('.components-notice.is-success')
		).toHaveText(/Finished: 1 new\./);
		await expect(
			mollie.getByLabel('E2E manual Mollie payment')
		).toBeDisabled();

		const state = runScript(
			'transaction-state.php',
			'E2E_TX_STATE',
			'tr_e2emanualimport'
		);
		expect(state.mollie_payment_id).toBe('tr_e2emanualimport');
		expect(state.post_id).toBeNull();
		expect(state.event_date_id).toBeNull();

		// Connected site.
		const sites = page.locator('.components-card', {
			hasText: 'Connected sites',
		});
		await sites
			.getByRole('button', {
				name: `Import transactions from ${siteLabel}`,
			})
			.click();
		await expect(sites.locator('.components-notice.is-success')).toHaveText(
			/Finished: 2 new\./
		);

		// The log survives a reload, newest first.
		await page.reload();
		const rows = page.locator('.fair-external-updates__log tbody tr');
		await expect(rows.nth(0)).toContainText(siteLabel);
		await expect(rows.nth(0)).toContainText('Import transactions');
		await expect(rows.nth(0)).toContainText('Succeeded');
		await expect(rows.nth(0)).toContainText('2 new');
		await expect(rows.nth(0)).toContainText(ADMIN_USER);
		await expect(rows.nth(1)).toContainText('Mollie (test)');
		await expect(rows.nth(1)).toContainText('Import payments');
		await expect(rows.nth(1)).toContainText('1 new');
	});

	test('reports a connected-site failure after partial progress, and the log keeps it', async ({
		page,
	}) => {
		const siteLabel = `E2E flaky shop ${Date.now()}`;
		await createSite(siteLabel, 'partial');

		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-external-updates'
		);

		const sites = page.locator('.components-card', {
			hasText: 'Connected sites',
		});
		await sites
			.getByRole('button', {
				name: `Import transactions from ${siteLabel}`,
			})
			.click();
		await expect(sites.locator('.components-notice.is-warning')).toHaveText(
			/Partly completed: 200 new\. The connected site could not be reached\./
		);

		await page.reload();
		const row = page
			.locator('.fair-external-updates__log tbody tr')
			.filter({ hasText: siteLabel });
		await expect(row).toContainText('Partly completed');
		await expect(row).toContainText(
			'The connected site could not be reached.'
		);
		await expect(row).toContainText('200 new');
	});
});
