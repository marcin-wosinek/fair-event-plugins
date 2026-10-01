/**
 * E2E: Compare events (#1677).
 *
 * An administrator opens Compare events from the Events menu, picks a current
 * and a comparison event, and sees both events' cumulative sales charts. The
 * selections live in the URL, so reopening the link restores the comparison,
 * and each chart downloads as a PNG named after both events.
 */

import fs from 'node:fs';
import { test, expect } from '../support/fixtures.js';
import { loginAsAdmin, runScript } from '../support/wp-cli.js';

const COMPARE_URL = '/wp-admin/admin.php?page=fair-events-compare-events';

function seedTickets(eventDateId, quantity) {
	const createdAt = new Date(Date.now() - 24 * 60 * 60 * 1000)
		.toISOString()
		.slice(0, 19)
		.replace('T', ' ');
	runScript(
		'seed-event-statistics-tickets.php',
		'E2E_EVENT_STATISTICS_TICKETS',
		`signup '${JSON.stringify({
			eventDateId,
			quantity,
			createdAt,
			units: Array.from({ length: quantity }, () => ({
				status: 'confirmed',
			})),
		})}'`
	);
}

async function chooseEvent(page, label, title) {
	const combobox = page.getByRole('combobox', { name: label });
	await combobox.click();
	await combobox.fill(title);
	await page.getByRole('option', { name: new RegExp(title) }).click();
	await expect(combobox).toHaveValue(new RegExp(title));
}

async function downloadChart(page, heading) {
	const card = page
		.locator('.fair-compare-events__chart-card')
		.filter({ has: page.getByRole('heading', { name: heading }) });
	const downloading = page.waitForEvent('download');
	await card.getByRole('button', { name: 'Download PNG' }).click();
	const download = await downloading;
	const image = fs.readFileSync(await download.path());
	return { filename: download.suggestedFilename(), image };
}

test.describe('Compare events', () => {
	test('selects two events, reopens the link, and downloads both charts', async ({
		page,
		seedEvent,
	}) => {
		const current = seedEvent('free');
		const comparison = seedEvent('free');
		seedTickets(current.eventDateId, 2);
		seedTickets(comparison.eventDateId, 1);

		// Distinct names, so each seeded event is findable in the dropdowns.
		const stamp = Date.now();
		const currentTitle = `Compare Spring ${stamp}`;
		const comparisonTitle = `Compare Autumn ${stamp}`;

		await loginAsAdmin(page);
		await page.goto(COMPARE_URL);
		await expect(
			page.getByRole('heading', { name: 'Compare events', level: 1 })
		).toBeVisible();
		await page.evaluate(
			(events) =>
				Promise.all(
					events.map(([id, title]) =>
						window.wp.apiFetch({
							path: `/fair-events/v1/event-dates/${id}`,
							method: 'PUT',
							data: { title },
						})
					)
				),
			[
				[current.eventDateId, currentTitle],
				[comparison.eventDateId, comparisonTitle],
			]
		);

		// Compare events sits immediately before Event Sources in the menu.
		const menuItems = (
			await page
				.locator('#toplevel_page_fair-events-calendar .wp-submenu a')
				.allTextContents()
		).map((text) => text.trim());
		expect(menuItems).toContain('Compare events');
		expect(menuItems[menuItems.indexOf('Compare events') + 1]).toBe(
			'Event Sources'
		);

		await page.reload();
		// Scoped to the page: notices repeat their text for screen readers.
		const compare = page.locator('.fair-compare-events');
		await expect(
			compare.getByText(
				'Choose a current event and a comparison event to compare their sales.'
			)
		).toBeVisible();

		await chooseEvent(page, 'Current event', currentTitle);
		await expect(page).toHaveURL(
			new RegExp(`[?&]current_event_date_id=${current.eventDateId}\\b`)
		);
		await expect(
			compare.getByText(
				'Choose a comparison event to compare with the current event.'
			)
		).toBeVisible();

		await chooseEvent(page, 'Comparison event', comparisonTitle);
		await expect(page).toHaveURL(
			new RegExp(
				`[?&]comparison_event_date_id=${comparison.eventDateId}\\b`
			)
		);
		await expect(page).toHaveURL(
			new RegExp(`[?&]current_event_date_id=${current.eventDateId}\\b`)
		);

		const expectComparison = async () => {
			for (const heading of [
				'Cumulative tickets sold',
				'Cumulative sales amount',
			]) {
				const card = page
					.locator('.fair-compare-events__chart-card')
					.filter({
						has: page.getByRole('heading', { name: heading }),
					});
				await expect(card.locator('.recharts-line')).toHaveCount(2);
				await expect(
					card.getByText(new RegExp(currentTitle))
				).toBeVisible();
				await expect(
					card.getByText(new RegExp(comparisonTitle))
				).toBeVisible();
			}
			// The same totals each event's own Statistics tab reports.
			const summaries = page.locator(
				'.fair-compare-events__summary-card'
			);
			await expect(summaries.nth(0)).toContainText(currentTitle);
			await expect(summaries.nth(0)).toContainText('2 tickets');
			await expect(summaries.nth(1)).toContainText(comparisonTitle);
			await expect(summaries.nth(1)).toContainText('1 ticket');
		};
		await expectComparison();

		// Reopening the shared link restores both selections and the charts.
		const link = page.url();
		await page.goto('/wp-admin/');
		await page.goto(link);
		await expect(
			page.getByRole('combobox', { name: 'Current event' })
		).toHaveValue(new RegExp(currentTitle));
		await expect(
			page.getByRole('combobox', { name: 'Comparison event' })
		).toHaveValue(new RegExp(comparisonTitle));
		await expectComparison();

		for (const [heading, slug] of [
			['Cumulative tickets sold', 'cumulative-tickets-sold'],
			['Cumulative sales amount', 'cumulative-sales-amount'],
		]) {
			const { filename, image } = await downloadChart(page, heading);
			expect(filename).toMatch(
				new RegExp(
					`^compare-spring-${stamp}-\\d{4}-\\d{2}-\\d{2}-vs-compare-autumn-${stamp}-\\d{4}-\\d{2}-\\d{2}-${slug}\\.png$`
				)
			);
			// A real PNG, not an empty or error download.
			expect(image.subarray(1, 4).toString()).toBe('PNG');
			expect(image.length).toBeGreaterThan(5000);
		}
	});
});
