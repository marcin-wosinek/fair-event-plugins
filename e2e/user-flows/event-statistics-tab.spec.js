/**
 * E2E: Statistics belongs to Fair Events (#1726).
 *
 * With Fair Events Experimental deactivated, an administrator opens the
 * Statistics tab from Manage Event, and the old standalone Statistics URL
 * (fair-events-event-statistics, from existing bookmarks) opens the same view.
 * Both views offer the sales history range for the cumulative charts (#2063).
 * Experimental is reactivated afterwards so the rest of the suite keeps its
 * default plugin set.
 */

import { test, expect } from '../support/fixtures.js';
import { loginAsAdmin, wpCli } from '../support/wp-cli.js';

test.describe('Event Statistics without Experimental', () => {
	test.beforeAll(() => {
		wpCli('plugin deactivate fair-events-experimental');
	});

	test.afterAll(() => {
		wpCli('plugin activate fair-events-experimental');
	});

	test('opens Statistics from Manage Event and from the old standalone URL', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free');
		await loginAsAdmin(page);

		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${event.eventDateId}`
		);
		const statisticsTab = page.getByRole('tab', { name: 'Statistics' });
		await expect(statisticsTab).toHaveCount(1);
		await statisticsTab.click();
		await expect(page).toHaveURL(/[?&]tab=statistics\b/);
		await expect(page.getByText('0 tickets')).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'Cumulative tickets sold' })
		).toBeVisible();

		// Both cumulative charts follow the sales history range (#2063).
		const salesHistory = page.getByRole('combobox', {
			name: 'Sales history',
		});
		await expect(salesHistory).toHaveValue('30');
		const salesCharts = page.locator(
			'.fair-event-statistics__sales-charts'
		);
		await expect(
			salesCharts.getByText('From 30 days before the event')
		).toHaveCount(2);
		await expect(
			salesCharts
				.locator('svg')
				.getByText('30 days before the event', { exact: true })
		).toHaveCount(2);
		const ninetyDays = page.waitForResponse(
			(response) =>
				response.url().includes('history_days=90') && response.ok()
		);
		await salesHistory.selectOption({
			label: 'From 90 days before the event',
		});
		await ninetyDays;
		await expect(
			salesCharts.getByText('From 90 days before the event')
		).toHaveCount(2);
		await expect(
			salesCharts
				.locator('svg')
				.getByText('90 days before the event', { exact: true })
		).toHaveCount(2);
		await expect(
			page.getByRole('button', { name: 'Download PNG' }).first()
		).toBeEnabled();

		// Capacity (#1711) loads without Experimental: the event and its
		// ticket type, and no activities, as none were configured.
		await expect(
			page.getByRole('heading', { name: 'Event capacity' })
		).toBeVisible();
		const ticketTypes = page
			.locator('.fair-event-statistics__chart-card')
			.filter({
				has: page.getByRole('heading', {
					name: 'Capacity by ticket type',
				}),
			});
		await expect(ticketTypes.getByText('Free Admission')).toBeVisible();
		await expect(ticketTypes.getByText('Unlimited')).toBeVisible();
		await expect(
			page.getByText('This event has no activities.')
		).toBeVisible();

		await page.goto(
			`/wp-admin/admin.php?page=fair-events-event-statistics&event_date_id=${event.eventDateId}`
		);
		await expect(page.getByText('0 tickets')).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'Cumulative tickets sold' })
		).toBeVisible();
		await salesHistory.selectOption({
			label: 'From 60 days before the event',
		});
		await expect(
			salesCharts.getByText('From 60 days before the event')
		).toHaveCount(2);
		await expect(
			salesCharts
				.locator('svg')
				.getByText('60 days before the event', { exact: true })
		).toHaveCount(2);
	});
});
