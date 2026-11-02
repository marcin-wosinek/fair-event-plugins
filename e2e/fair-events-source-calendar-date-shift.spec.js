/**
 * Moving an event's start date keeps its length (#2089).
 *
 * Starts where the report did: an event feed's preview calendar. The event
 * pill opens the public event page, whose admin bar "Manage Event" link
 * opens the event editor. Moving the start date across the October
 * daylight-saving change shifts the end date with it, keeps the entered
 * times, and survives saving and reopening.
 *
 * Needs a current `npm run build` in fair-events and fair-events-experimental.
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

const SOURCES_PAGE = '/wp-admin/admin.php?page=fair-events-sources';
const SOURCE_VIEW_PAGE =
	'/wp-admin/admin.php?page=fair-events-source-view&source_id=';
// A month far from other fixtures; Europe's DST change is on 2036-10-26.
const MONTH = '2036-10';

/** Call the REST API from an admin page, so apiFetch sends the nonce. */
const adminApiFetch = (page, options) =>
	page.evaluate((opts) => window.wp.apiFetch(opts), options);

const suffix = Date.now();
const title = `Morning class ${suffix}`;
const created = {
	categoryId: null,
	postId: null,
	eventDateId: null,
	source: null,
};

test.use({ timezoneId: 'Europe/Madrid' });

test.describe('Event dates — moving the start date from a feed preview', () => {
	test.setTimeout(120_000);

	test.beforeAll(async ({ browser }) => {
		const page = await browser.newPage();
		await loginAsAdmin(page);
		await page.goto(SOURCES_PAGE);
		await page.waitForFunction(() => window.wp?.apiFetch);

		const category = await adminApiFetch(page, {
			path: '/wp/v2/categories',
			method: 'POST',
			data: { name: `Date shift ${suffix}` },
		});
		created.categoryId = category.id;

		const post = await adminApiFetch(page, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: { title, status: 'publish' },
		});
		created.postId = post.id;

		const eventDate = await adminApiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title,
				link_type: 'post',
				start_date: `${MONTH}-13`,
				end_date: `${MONTH}-13`,
				start_time: '07:45:00',
				end_time: '08:45:00',
				all_day: false,
				categories: [category.id],
			},
		});
		created.eventDateId = eventDate.id;
		await adminApiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}`,
			method: 'PUT',
			data: { event_id: post.id },
		});

		created.source = await adminApiFetch(page, {
			path: '/fair-events/v1/sources',
			method: 'POST',
			data: {
				name: `E2E date shift feed ${suffix}`,
				data_sources: [
					{
						source_type: 'categories',
						config: { category_ids: [category.id] },
					},
				],
			},
		});
		await page.close();
	});

	test.afterAll(async ({ browser }) => {
		const page = await browser.newPage();
		await loginAsAdmin(page);
		await page.goto(SOURCES_PAGE);
		await page.waitForFunction(() => window.wp?.apiFetch);
		const remove = (path) =>
			adminApiFetch(page, { path, method: 'DELETE' }).catch(() => {});
		if (created.source) {
			await remove(`/fair-events/v1/sources/${created.source.id}`);
		}
		if (created.eventDateId) {
			await remove(`/fair-events/v1/event-dates/${created.eventDateId}`);
		}
		if (created.postId) {
			await remove(`/wp/v2/fair_event/${created.postId}?force=true`);
		}
		if (created.categoryId) {
			await remove(`/wp/v2/categories/${created.categoryId}?force=true`);
		}
		await page.close();
	});

	test('shifts the end date with the start and keeps it after saving', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			`${SOURCE_VIEW_PAGE}${created.source.id}&month=${MONTH}`
		);

		// Feed preview → public event page → admin bar "Manage Event".
		await page
			.locator('.fair-events-calendar-event', { hasText: title })
			.click();
		await expect(page.locator('#wpadminbar')).toBeAttached();
		const manageHref = await page
			.locator('#wpadminbar a', { hasText: 'Manage Event' })
			.getAttribute('href');
		expect(manageHref).toContain(`event_date_id=${created.eventDateId}`);
		// Admin-bar clicks can stall headless rendering; follow the link.
		await page.goto(manageHref);

		const startDate = page.getByLabel('Start date');
		const endDate = page.getByLabel('End date');
		const startTime = page.getByLabel('Start time (optional)');
		const endTime = page.getByLabel('End time (optional)');
		await expect(startDate).toHaveValue(`${MONTH}-13`, {
			timeout: 20_000,
		});
		await expect(endDate).toHaveValue(`${MONTH}-13`);

		// Later, across the daylight-saving change: the end follows.
		await startDate.fill(`${MONTH}-27`);
		await expect(endDate).toHaveValue(`${MONTH}-27`);
		await expect(startTime).toHaveValue('07:45');
		await expect(endTime).toHaveValue('08:45');

		// apiFetch sends PUT as POST with an X-HTTP-Method-Override header.
		const saved = page.waitForResponse(
			(response) =>
				decodeURIComponent(response.url()).includes(
					`event-dates/${created.eventDateId}`
				) && response.request().method() !== 'GET'
		);
		await page.getByRole('button', { name: 'Save event details' }).click();
		expect((await saved).ok()).toBe(true);

		const stored = await adminApiFetch(page, {
			path: `/fair-events/v1/event-dates/${created.eventDateId}`,
		});
		expect(stored).toMatchObject({
			start_date: `${MONTH}-27`,
			end_date: `${MONTH}-27`,
			all_day: false,
		});
		expect(stored.start_time).toMatch(/^07:45/);
		expect(stored.end_time).toMatch(/^08:45/);

		// Reopen: the moved dates and the entered times stay.
		await page.reload();
		await expect(startDate).toHaveValue(`${MONTH}-27`, {
			timeout: 20_000,
		});
		await expect(endDate).toHaveValue(`${MONTH}-27`);
		await expect(startTime).toHaveValue('07:45');
		await expect(endTime).toHaveValue('08:45');
	});
});
