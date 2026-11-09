/**
 * E2E: Statistics on installations that never had Fair Audience (#2112).
 *
 * Each describe block installs its own WordPress next to the shared tests
 * site (e2e/drop-ins/db.php, e2e/support/fresh-site.js) with only the
 * plugins it names ever activated, and the browser selects it with the
 * X-Fair-E2E-Site header. Deactivating plugins on the shared site would
 * leave their tables and history behind.
 *
 * In both combinations an administrator opens Statistics from Manage Event
 * and from the standalone bookmark URL, sees ticket, activity and capacity
 * figures, and downloads the ticket chart as a real PNG. Without Fair
 * Payments Connector revenue is unavailable (no amount, no revenue
 * download); with it the revenue chart downloads too. An empty event says
 * so.
 */

import { readFile } from 'node:fs/promises';
import { test, expect } from '@playwright/test';
import { installFreshSite, dropFreshSite } from '../support/fresh-site.js';
import { ADMIN_USER, ADMIN_PASSWORD } from '../support/wp-cli.js';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

function siteLocal(daysAgo) {
	const value = new Date();
	value.setUTCDate(value.getUTCDate() - daysAgo);
	return `${value.toISOString().slice(0, 10)} 12:00:00`;
}

/**
 * Log in through the page's own request context, so the session cookies
 * and the fresh-site header are the browser's.
 *
 * @param {import('@playwright/test').Page} page Page.
 */
async function login(page) {
	const api = page.context().request;
	await api.get('/wp-login.php');
	const response = await api.post('/wp-login.php', {
		form: { log: ADMIN_USER, pwd: ADMIN_PASSWORD, testcookie: '1' },
		maxRedirects: 0,
	});
	expect(response.status()).toBe(302);
}

/**
 * Download one chart card's PNG and check it is an image.
 *
 * @param {import('@playwright/test').Page}    page Page.
 * @param {import('@playwright/test').Locator} card Chart card.
 */
async function expectPngDownload(page, card) {
	const [download] = await Promise.all([
		page.waitForEvent('download'),
		card.getByRole('button', { name: 'Download PNG' }).click(),
	]);
	expect(download.suggestedFilename()).toMatch(/\.png$/);
	const bytes = await readFile(await download.path());
	expect(bytes.subarray(0, 4).equals(PNG_SIGNATURE)).toBe(true);
	expect(bytes.length).toBeGreaterThan(1000);
}

for (const combination of [
	{ site: 'events-only', plugins: ['fair-events'], connector: false },
	{
		site: 'events-connector',
		plugins: ['fair-events', 'fair-payments-connector'],
		connector: true,
	},
]) {
	test.describe(`Statistics on a fresh install with ${combination.plugins.join(
		' + '
	)}`, () => {
		test.describe.configure({ mode: 'serial', timeout: 180 * 1000 });
		test.use({
			extraHTTPHeaders: { 'X-Fair-E2E-Site': combination.site },
			acceptDownloads: true,
		});

		let populated;
		let empty;

		test.beforeAll(async () => {
			test.setTimeout(180 * 1000);
			const site = await installFreshSite(
				combination.site,
				combination.plugins
			);
			const state = await site.state();
			expect(state.audienceTables).toEqual([]);
			expect(state.connectorTables.length > 0).toBe(
				combination.connector
			);

			populated = await site.seedEvent('paid');
			await site.seed({
				eventDateId: populated.eventDateId,
				ticketTypeId: populated.ticketTypeId,
				eventCapacity: 10,
				activities: [{ name: 'Yoga', capacity: 5 }, { name: 'Dance' }],
				purchases: [
					{
						quantity: 2,
						createdAt: siteLocal(3),
						activities: [0, 1],
						paid: 50,
					},
					{
						quantity: 1,
						createdAt: siteLocal(2),
						activities: [0],
					},
				],
			});
			empty = await site.seedEvent('free');
		});

		test.afterAll(async () => {
			await dropFreshSite(combination.site);
		});

		test('opens Statistics from Manage Event and downloads its charts', async ({
			page,
		}) => {
			await login(page);
			await page.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${populated.eventDateId}`
			);
			const statisticsTab = page.getByRole('tab', {
				name: 'Statistics',
			});
			await expect(statisticsTab).toHaveCount(1);
			await statisticsTab.click();
			await expect(page).toHaveURL(/[?&]tab=statistics\b/);

			const summary = page.locator('.fair-event-statistics__summary');
			await expect(summary.getByText('3 tickets')).toBeVisible();
			if (combination.connector) {
				await expect(summary.getByText(/€\s?50[.,]00/)).toBeVisible();
				await expect(
					summary.getByText('Revenue unavailable')
				).toHaveCount(0);
			} else {
				await expect(
					summary.getByText('Revenue unavailable')
				).toBeVisible();
				await expect(summary.getByText(/€/)).toHaveCount(0);
				await expect(
					page.getByText(/Activate Fair Payments Connector/)
				).toBeVisible();
			}

			const cards = page.locator('.fair-event-statistics__chart-card');
			const card = (name) =>
				cards.filter({ has: page.getByRole('heading', { name }) });
			await expect(
				card('Capacity by activity').getByText('Yoga')
			).toBeVisible();
			await expect(
				card('Event capacity').getByText('Remaining')
			).toBeVisible();
			await expect(card('Tickets per activity')).toBeVisible();

			await expectPngDownload(page, card('Cumulative tickets sold'));
			const revenueDownload = card('Cumulative sales amount').getByRole(
				'button',
				{ name: 'Download PNG' }
			);
			if (combination.connector) {
				await expectPngDownload(page, card('Cumulative sales amount'));
			} else {
				await expect(revenueDownload).toHaveAttribute(
					'aria-disabled',
					'true'
				);
			}
		});

		test('opens the same Statistics from the standalone bookmark', async ({
			page,
		}) => {
			await login(page);
			await page.goto(
				`/wp-admin/admin.php?page=fair-events-event-statistics&event_date_id=${populated.eventDateId}`
			);
			await expect(
				page.getByRole('heading', {
					level: 1,
					name: 'Event Statistics',
				})
			).toBeVisible();
			await expect(
				page.getByRole('link', { name: 'Back to Manage Event' })
			).toHaveAttribute(
				'href',
				new RegExp(`event_date_id=${populated.eventDateId}$`)
			);
			const summary = page.locator('.fair-event-statistics__summary');
			await expect(summary.getByText('3 tickets')).toBeVisible();
			await expectPngDownload(
				page,
				page.locator('.fair-event-statistics__chart-card').filter({
					has: page.getByRole('heading', {
						name: 'Cumulative tickets sold',
					}),
				})
			);

			// An empty event says so instead of showing bare zeros.
			await page.goto(
				`/wp-admin/admin.php?page=fair-events-event-statistics&event_date_id=${empty.eventDateId}`
			);
			await expect(summary.getByText('0 tickets')).toBeVisible();
			await expect(
				page.getByText(
					/No tickets have been confirmed for this date yet/
				)
			).toBeVisible();
		});
	});
}
