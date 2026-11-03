/**
 * The event feed preview renders on the shared admin calendar (#1847):
 * feed details, month navigation with browser history, event links, crowded
 * days in grid and mobile agenda layouts, and the empty and error states.
 * The detail page's header, weekly-summary action and collapsed
 * integrations (#2083) edit, open and fit every viewport.
 *
 * Needs a current `npm run build` in fair-events-experimental.
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

const SOURCES_PAGE = '/wp-admin/admin.php?page=fair-events-sources';
const SOURCE_VIEW_PAGE =
	'/wp-admin/admin.php?page=fair-events-source-view&source_id=';
// Months far from any fixture data other specs create.
const MONTH = '2036-05';
const EMPTY_MONTH = '2036-06';

/** Call the REST API from an admin page, so apiFetch sends the nonce. */
const adminApiFetch = (page, options) =>
	page.evaluate((opts) => window.wp.apiFetch(opts), options);

const suffix = Date.now();
const crowdedTitles = [1, 2, 3, 4, 5].map((n) => `Crowded ${n} ${suffix}`);
const externalTitle = `Partner festival ${suffix}`;
const pageTitle = `Feed public page ${suffix}`;
const created = {
	categoryId: null,
	eventDateIds: [],
	source: null,
	pageId: null,
};

const calendarDay = (page, day) =>
	page.locator('.fair-events-calendar-day.current-month').filter({
		has: page.locator('.fair-events-calendar-day-number', {
			hasText: new RegExp(`^${day}$`),
		}),
	});

test.describe('Fair Events Experimental — event feed preview', () => {
	test.setTimeout(120_000);

	test.beforeAll(async ({ browser }) => {
		const page = await browser.newPage();
		await loginAsAdmin(page);
		await page.goto(SOURCES_PAGE);
		await page.waitForFunction(() => window.wp?.apiFetch);

		const category = await adminApiFetch(page, {
			path: '/wp/v2/categories',
			method: 'POST',
			data: { name: `Feed preview ${suffix}` },
		});
		created.categoryId = category.id;

		const publicPage = await adminApiFetch(page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: { title: pageTitle, status: 'publish' },
		});
		created.pageId = publicPage.id;

		const fixtures = [
			...crowdedTitles.map((title, index) => ({
				title,
				start_date: `${MONTH}-12`,
				start_time: `${String(9 + index).padStart(2, '0')}:00:00`,
			})),
			{
				title: externalTitle,
				start_date: `${MONTH}-20`,
				start_time: '12:00:00',
				link_type: 'external',
				external_url: 'https://example.com/festival',
			},
		];
		for (const fixture of fixtures) {
			const eventDate = await adminApiFetch(page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					end_date: fixture.start_date,
					all_day: false,
					categories: [category.id],
					...fixture,
				},
			});
			created.eventDateIds.push(eventDate.id);
		}

		created.source = await adminApiFetch(page, {
			path: '/fair-events/v1/sources',
			method: 'POST',
			data: {
				name: `E2E preview feed ${suffix}`,
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
		for (const id of created.eventDateIds) {
			await remove(`/fair-events/v1/event-dates/${id}`);
		}
		if (created.categoryId) {
			await remove(`/wp/v2/categories/${created.categoryId}?force=true`);
		}
		if (created.pageId) {
			await remove(`/wp/v2/pages/${created.pageId}?force=true`);
		}
		await page.close();
	});

	test('shows feed details, links and navigates through history', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			`${SOURCE_VIEW_PAGE}${created.source.id}&month=${MONTH}&e2e=keep`
		);

		await expect(
			page.getByRole('heading', { name: created.source.name })
		).toBeVisible({ timeout: 20_000 });
		await expect(page.getByText('1 configured source')).toBeVisible();

		// Grid mode clamps the crowded day to three rows plus "+2 more".
		const crowded = calendarDay(page, 12);
		await expect(crowded.getByText(crowdedTitles[0])).toBeVisible();
		await expect(crowded.getByText(crowdedTitles[2])).toBeVisible();
		await expect(crowded.getByText(crowdedTitles[3])).toBeHidden();
		await expect(crowded.getByText('+2 more')).toBeVisible();

		// Feed previews keep event destinations and gain no creation actions.
		const external = calendarDay(page, 20);
		await expect(
			external.getByRole('link', { name: externalTitle })
		).toHaveAttribute('href', 'https://example.com/festival');
		const destination = external.getByTitle('Open link destination');
		await expect(destination).toHaveAttribute('target', '_blank');
		await expect(destination).toHaveAttribute('rel', 'noopener noreferrer');
		await expect(
			page.getByRole('button', { name: 'Add event' })
		).toHaveCount(0);

		await page.getByRole('button', { name: 'Next' }).click();
		await expect
			.poll(() => new URL(page.url()).searchParams.get('month'))
			.toBe(EMPTY_MONTH);
		expect(new URL(page.url()).searchParams.get('source_id')).toBe(
			String(created.source.id)
		);
		expect(new URL(page.url()).searchParams.get('e2e')).toBe('keep');
		await expect(page.getByText('June 2036')).toBeVisible();
		// The agenda's empty message is a mobile-only element.
		await expect(page.getByText('No events this month.')).toBeHidden();

		await page.goBack();
		await expect(page.getByText('May 2036')).toBeVisible();
		await expect(
			calendarDay(page, 12).getByText(crowdedTitles[0])
		).toBeVisible();

		await page.goForward();
		await expect(page.getByText('June 2036')).toBeVisible();

		await page.reload();
		await expect(page.getByText('June 2036')).toBeVisible({
			timeout: 20_000,
		});
	});

	test('lists every event of a crowded day in the mobile agenda', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await loginAsAdmin(page);
		await page.goto(
			`${SOURCE_VIEW_PAGE}${created.source.id}&month=${MONTH}`
		);

		for (const title of crowdedTitles) {
			await expect(page.getByText(title)).toBeVisible({
				timeout: 20_000,
			});
		}
		await expect(page.getByText('+2 more')).toBeHidden();

		await page.getByRole('button', { name: 'Next' }).click();
		await expect(page.getByText('No events this month.')).toBeVisible();
	});

	test('reports a failed events request instead of an empty month', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await loginAsAdmin(page);
		await page.route(
			(url) =>
				decodeURIComponent(url.toString()).includes(
					`/sources/${created.source.slug}/json`
				),
			(route) =>
				route.fulfill({
					status: 500,
					contentType: 'application/json',
					body: JSON.stringify({
						code: 'e2e_error',
						message: 'E2E feed failure',
						data: { status: 500 },
					}),
				})
		);
		await page.goto(
			`${SOURCE_VIEW_PAGE}${created.source.id}&month=${EMPTY_MONTH}`
		);

		await expect(
			page.locator('.components-notice').getByText('E2E feed failure')
		).toBeVisible({
			timeout: 20_000,
		});
		await expect(page.locator('.fair-events-calendar-grid')).toHaveCount(1);
		await expect(page.getByText('No events this month.')).toHaveCount(0);
	});

	test('edits the feed, opens its weekly summary and shows integrations', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			`${SOURCE_VIEW_PAGE}${created.source.id}&month=${MONTH}`
		);

		const edit = page.getByRole('button', { name: 'Edit event feed' });
		await expect(edit).toHaveCount(1, { timeout: 20_000 });
		await expect(
			page.getByText('Public page: none selected', { exact: false })
		).toBeVisible();
		// Without a page the summary section stays, its action explained.
		await expect(
			page.getByRole('heading', { name: 'Weekly summary' })
		).toBeVisible();
		const unavailable = page.getByRole('button', {
			name: 'Open weekly summary',
		});
		await expect(unavailable).toHaveAttribute('aria-disabled', 'true');
		await expect(unavailable).toHaveAccessibleDescription(
			/Choose a public page in the feed settings/
		);

		// Linking a page in the editor refreshes the header and summary.
		await edit.click();
		const dialog = page.getByRole('dialog');
		await dialog
			.getByLabel('Linked Page')
			.selectOption({ label: pageTitle });
		await dialog.getByRole('button', { name: 'Update event feed' }).click();
		await expect(dialog).toHaveCount(0);

		await expect(page.getByText(`Public page: ${pageTitle}`)).toBeVisible();
		await expect(
			page.getByRole('link', { name: /Open public page/ })
		).toHaveAttribute('target', '_blank');

		const summary = page.getByRole('link', {
			name: /Open weekly summary/,
		});
		await expect(summary).toHaveAttribute(
			'href',
			new RegExp(`fair-events-weekly-summary/${created.source.slug}/$`)
		);
		await expect(summary).toHaveAttribute('target', '_blank');
		const [summaryPage] = await Promise.all([
			page.context().waitForEvent('page'),
			summary.click(),
		]);
		await summaryPage.waitForLoadState();
		expect(summaryPage.url()).toBe(await summary.getAttribute('href'));
		await expect(
			summaryPage.getByRole('heading', { level: 1, name: pageTitle })
		).toBeVisible();
		// The public page keeps its own message copying.
		await expect(
			summaryPage.getByRole('button', { name: 'Copy WhatsApp message' })
		).toBeVisible();
		await summaryPage.close();
		// Opening is the section's only action.
		await expect(
			page.getByRole('button', { name: 'Copy summary link' })
		).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Show summary link' })
		).toHaveCount(0);
		await expect(
			page.getByRole('textbox', { name: 'Weekly summary link' })
		).toHaveCount(0);

		const integrations = page.getByRole('button', {
			name: 'Subscription and integrations',
		});
		await expect(integrations).toHaveAttribute('aria-expanded', 'false');
		await expect(page.getByText(created.source.slug)).toBeHidden();
		await integrations.click();
		await expect(page.getByText(created.source.slug)).toBeVisible();
		await expect(page.getByRole('button', { name: 'iCal' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'JSON' })).toBeVisible();

		// Long names and URLs wrap instead of widening the page.
		for (const [width, height] of [
			[1280, 900],
			[768, 1024],
			[375, 812],
		]) {
			await page.setViewportSize({ width, height });
			await expect
				.poll(() =>
					page.evaluate(
						() =>
							document.documentElement.scrollWidth -
							document.documentElement.clientWidth
					)
				)
				.toBeLessThanOrEqual(0);
		}
	});
});
