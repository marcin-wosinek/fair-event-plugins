/**
 * Moving an event's start time keeps its length (#2089).
 *
 * In Manage Event, moving a 10:00–12:00 event to a 23:00 start moves its end
 * to 01:00 on the next day; the moved times survive saving and reopening.
 *
 * Needs a current `npm run build` in fair-events.
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

const MANAGE_PAGE =
	'/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=';
// A month far from other fixtures.
const DAY = '2036-11-14';
const NEXT_DAY = '2036-11-15';

/** Call the REST API from an admin page, so apiFetch sends the nonce. */
const adminApiFetch = (page, options) =>
	page.evaluate((opts) => window.wp.apiFetch(opts), options);

const suffix = Date.now();
const title = `Evening workshop ${suffix}`;
const created = { postId: null, eventDateId: null };

test.use({ timezoneId: 'Europe/Madrid' });

test.describe('Event dates — moving the start time in Manage Event', () => {
	test.setTimeout(120_000);

	test.beforeAll(async ({ browser }) => {
		const page = await browser.newPage();
		await loginAsAdmin(page);
		await page.goto('/wp-admin/');
		await page.waitForFunction(() => window.wp?.apiFetch);

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
				start_date: DAY,
				end_date: DAY,
				start_time: '10:00:00',
				end_time: '12:00:00',
				all_day: false,
			},
		});
		created.eventDateId = eventDate.id;
		await adminApiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}`,
			method: 'PUT',
			data: { event_id: post.id },
		});
		await page.close();
	});

	test.afterAll(async ({ browser }) => {
		const page = await browser.newPage();
		await loginAsAdmin(page);
		await page.goto('/wp-admin/');
		await page.waitForFunction(() => window.wp?.apiFetch);
		const remove = (path) =>
			adminApiFetch(page, { path, method: 'DELETE' }).catch(() => {});
		if (created.eventDateId) {
			await remove(`/fair-events/v1/event-dates/${created.eventDateId}`);
		}
		if (created.postId) {
			await remove(`/wp/v2/fair_event/${created.postId}?force=true`);
		}
		await page.close();
	});

	test('shifts the end with the start time and keeps it after saving', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(`${MANAGE_PAGE}${created.eventDateId}`);

		const startDate = page.getByLabel('Start date');
		const endDate = page.getByLabel('End date');
		const startTime = page.getByLabel('Start time (optional)');
		const endTime = page.getByLabel('End time (optional)');
		await expect(startTime).toHaveValue('10:00', { timeout: 20_000 });
		await expect(endTime).toHaveValue('12:00');

		// Later, past midnight: the end moves to the next day.
		await startTime.fill('23:00');
		await expect(endTime).toHaveValue('01:00');
		await expect(endDate).toHaveValue(NEXT_DAY);
		await expect(startDate).toHaveValue(DAY);

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
			start_date: DAY,
			end_date: NEXT_DAY,
			all_day: false,
		});
		expect(stored.start_time).toMatch(/^23:00/);
		expect(stored.end_time).toMatch(/^01:00/);

		// Reopen: both endpoints stay where they were moved.
		await page.reload();
		await expect(startTime).toHaveValue('23:00', { timeout: 20_000 });
		await expect(startDate).toHaveValue(DAY);
		await expect(endDate).toHaveValue(NEXT_DAY);
		await expect(endTime).toHaveValue('01:00');
	});
});
