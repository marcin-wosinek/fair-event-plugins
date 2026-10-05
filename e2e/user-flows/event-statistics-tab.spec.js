/**
 * E2E: Statistics belongs to Fair Events (#1726).
 *
 * With Fair Events Experimental deactivated, an administrator opens the
 * Statistics tab from Manage Event, and the old standalone Statistics URL
 * (fair-events-event-statistics, from existing bookmarks) opens the same view.
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
	});
});
