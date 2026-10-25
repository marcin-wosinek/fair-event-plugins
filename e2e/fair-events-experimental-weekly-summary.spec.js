/**
 * Operator weekly-summary links (#2045): a public page per Events Week block,
 * named by the block's anchor, whose copied text is exactly the block's own
 * "Copy summary" text for the same page and week.
 *
 * Needs a current `npm run build` in fair-events and fair-events-experimental.
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

const ADMIN_PAGE = '/wp-admin/admin.php?page=fair-events-all-events';
// Weeks far from any fixture data other specs create.
const WEEK = '2036-W20';
const EMPTY_WEEK = '2036-W22';
// 2032 has 53 ISO weeks; its last one ends in 2033.
const LAST_WEEK = '2032-W53';
const FIRST_WEEK = '2033-W01';

const suffix = Date.now();
const COMMUNITIES = ['valencia', 'madrid', 'barcelona'];
const created = { pages: [], posts: [], eventDates: [], categories: [] };
const fixtures = {};

/** Call the REST API from an admin page, so apiFetch sends the nonce. */
const adminApiFetch = (page, options) =>
	page.evaluate((opts) => window.wp.apiFetch(opts), options);

const operatorPath = (slug, anchor, week) =>
	`/${slug}/?fair_weekly_summary=${anchor}` +
	(week !== undefined ? `&week_view=${encodeURIComponent(week)}` : '');

/** The block's own copy-summary text for a page and week. */
async function blockSummary(page, slug, week) {
	await page.goto(
		`/${slug}/` + (week ? `?week_view=${encodeURIComponent(week)}` : '')
	);
	return page
		.locator('.fair-events-copy-summary-btn')
		.getAttribute('data-summary');
}

/** The operator page's summary text. */
async function operatorSummary(page, slug, anchor, week) {
	await page.goto(operatorPath(slug, anchor, week));
	return page.locator('.fair-weekly-summary__text').inputValue();
}

const weekBlock = (attrs) =>
	`<!-- wp:fair-events/events-week ${JSON.stringify({
		showCopySummary: true,
		...attrs,
	})} /-->`;

test.describe('Fair Events Experimental — operator weekly summary', () => {
	test.setTimeout(120_000);

	test.beforeAll(async ({ browser }) => {
		const page = await browser.newPage();
		await loginAsAdmin(page);
		await page.goto(ADMIN_PAGE);
		await page.waitForFunction(() => window.wp?.apiFetch);

		const createPage = async (slug, title, content, extra = {}) => {
			const created_page = await adminApiFetch(page, {
				path: '/wp/v2/pages',
				method: 'POST',
				data: {
					title,
					slug,
					status: 'publish',
					content,
					...extra,
				},
			});
			created.pages.push(created_page.id);
			return new URL(created_page.link).pathname.replace(/^\/|\/$/g, '');
		};
		const createEventDate = async (data) => {
			const eventDate = await adminApiFetch(page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: { all_day: false, ...data },
			});
			created.eventDates.push(eventDate.id);
			return eventDate;
		};
		const linkedEvent = async (title, status, category, dates) => {
			const post = await adminApiFetch(page, {
				path: '/wp/v2/fair_event',
				method: 'POST',
				data: { title, status },
			});
			created.posts.push(post.id);
			const eventDate = await createEventDate({
				title,
				link_type: 'post',
				categories: [category],
				...dates,
			});
			await adminApiFetch(page, {
				path: `/fair-events/v1/event-dates/${eventDate.id}`,
				method: 'PUT',
				data: { event_id: post.id },
			});
		};

		for (const community of COMMUNITIES) {
			const category = await adminApiFetch(page, {
				path: '/wp/v2/categories',
				method: 'POST',
				data: { name: `Weekly ${community} ${suffix}` },
			});
			created.categories.push(category.id);

			const titles = {
				timed: `Jam in the park — ${community} ${suffix}`,
				apostrophe: `Teachers' "open" class ${community} ${suffix}`,
				multiday: `Weekend retreat ${community} ${suffix}`,
				series: `Daily handstands ${community} ${suffix}`,
				boundary: `New Year jam ${community} ${suffix}`,
				draft: `Draft plan ${community} ${suffix}`,
				private: `Private rehearsal ${community} ${suffix}`,
			};

			await createEventDate({
				title: titles.timed,
				start_date: '2036-05-13',
				start_time: '18:00:00',
				end_date: '2036-05-13',
				end_time: '20:00:00',
				categories: [category.id],
			});
			await linkedEvent(titles.apostrophe, 'publish', category.id, {
				start_date: '2036-05-14',
				start_time: '19:30:00',
				end_date: '2036-05-14',
				end_time: '21:00:00',
			});
			await createEventDate({
				title: titles.multiday,
				start_date: '2036-05-16',
				end_date: '2036-05-18',
				all_day: true,
				categories: [category.id],
			});
			const series = await createEventDate({
				title: titles.series,
				start_date: '2036-05-12',
				start_time: '08:00:00',
				end_date: '2036-05-12',
				end_time: '09:00:00',
				categories: [category.id],
			});
			await adminApiFetch(page, {
				path: `/fair-events/v1/event-dates/${series.id}`,
				method: 'PUT',
				data: { rrule: 'FREQ=DAILY;COUNT=3' },
			});
			await createEventDate({
				title: titles.boundary,
				start_date: '2032-12-31',
				start_time: '22:00:00',
				end_date: '2033-01-01',
				end_time: '02:00:00',
				categories: [category.id],
			});
			await linkedEvent(titles.draft, 'draft', category.id, {
				start_date: '2036-05-15',
				start_time: '10:00:00',
				end_date: '2036-05-15',
				end_time: '11:00:00',
			});
			await linkedEvent(titles.private, 'private', category.id, {
				start_date: '2036-05-15',
				start_time: '12:00:00',
				end_date: '2036-05-15',
				end_time: '13:00:00',
			});

			const slug = await createPage(
				`weekly-${community}-${suffix}`,
				`Acro agenda ${community}'s week`,
				'<!-- wp:group --><div class="wp-block-group">' +
					weekBlock({
						anchor: 'community-week',
						categories: [category.id],
					}) +
					'</div><!-- /wp:group -->'
			);
			fixtures[community] = { slug, titles };
		}

		const firstCategory = created.categories[0];
		fixtures.drafts = await createPage(
			`weekly-drafts-${suffix}`,
			'Calendar with drafts',
			weekBlock({ anchor: 'with-drafts', showDrafts: true })
		);
		fixtures.duplicate = await createPage(
			`weekly-duplicate-${suffix}`,
			'Calendar with a repeated anchor',
			weekBlock({ anchor: 'twice', categories: [firstCategory] }) +
				weekBlock({ anchor: 'twice' })
		);
		fixtures.privatePage = await createPage(
			`weekly-private-${suffix}`,
			'Private calendar',
			weekBlock({ anchor: 'community-week' }),
			{ status: 'private' }
		);
		fixtures.protectedPage = await createPage(
			`weekly-protected-${suffix}`,
			'Protected calendar',
			weekBlock({ anchor: 'community-week' }),
			{ password: 'secret' }
		);
		await page.close();
	});

	test.afterAll(async ({ browser }) => {
		const page = await browser.newPage();
		await loginAsAdmin(page);
		await page.goto(ADMIN_PAGE);
		await page.waitForFunction(() => window.wp?.apiFetch);
		const remove = (path) =>
			adminApiFetch(page, { path, method: 'DELETE' }).catch(() => {});
		for (const id of created.eventDates) {
			await remove(`/fair-events/v1/event-dates/${id}`);
		}
		for (const id of created.posts) {
			await remove(`/wp/v2/fair_event/${id}?force=true`);
		}
		for (const id of created.pages) {
			await remove(`/wp/v2/pages/${id}?force=true`);
		}
		for (const id of created.categories) {
			await remove(`/wp/v2/categories/${id}?force=true`);
		}
		await page.close();
	});

	test('copied text matches each community’s Events Week block exactly', async ({
		page,
	}) => {
		for (const community of COMMUNITIES) {
			const { slug, titles } = fixtures[community];
			const expected = await blockSummary(page, slug, WEEK);
			const actual = await operatorSummary(
				page,
				slug,
				'community-week',
				WEEK
			);

			expect(actual).toBe(expected);
			const lines = actual.split('\n');
			expect(lines[0]).toContain(`Acro agenda ${community}’s week`);
			expect(lines[0]).toContain(`/${slug}/`);
			// Timed, multi-day, recurring and post-linked events, in order.
			expect(actual).toContain(titles.timed);
			expect(actual).toContain(titles.apostrophe);
			expect(actual).toContain(titles.multiday);
			expect(
				lines.filter((line) => line.includes(titles.series))
			).toHaveLength(3);
			expect(lines).toHaveLength(1 + 3 + 3);

			// Other communities' events stay out.
			for (const other of COMMUNITIES.filter((c) => c !== community)) {
				expect(actual).not.toContain(fixtures[other].titles.timed);
			}
		}
	});

	test('lists only public events, for visitors and logged-in organizers alike', async ({
		page,
	}) => {
		const { slug, titles } = fixtures.valencia;
		for (const loggedIn of [false, true]) {
			if (loggedIn) {
				await loginAsAdmin(page);
			}
			await page.goto(operatorPath(slug, 'community-week', WEEK));
			const main = page.locator('main.fair-weekly-summary');
			await expect(main.getByText(titles.timed).first()).toBeVisible();
			await expect(main).not.toContainText(titles.draft);
			await expect(main).not.toContainText(titles.private);
			expect(
				await page.locator('.fair-weekly-summary__text').inputValue()
			).not.toContain(titles.draft);
		}
	});

	test('identifies the calendar and week, and navigates across a year boundary', async ({
		page,
	}) => {
		const { slug, titles } = fixtures.madrid;
		const range = await page
			.goto(`/${slug}/?week_view=${LAST_WEEK}`)
			.then(() => page.locator('.navigation-title').textContent());

		await page.goto(operatorPath(slug, 'community-week', LAST_WEEK));
		await expect(
			page.getByRole('heading', { level: 1, name: /madrid/i })
		).toBeVisible();
		await expect(
			page.locator('.fair-weekly-summary__range strong')
		).toHaveText(range.trim());
		await expect(page.getByText('Week 53, 2032')).toBeVisible();
		await expect(
			page
				.locator('.fair-weekly-summary__events')
				.getByText(titles.boundary)
		).toBeVisible();
		expect(
			await page.locator('.fair-weekly-summary__text').inputValue()
		).toBe(await blockSummary(page, slug, LAST_WEEK));

		await page.goto(operatorPath(slug, 'community-week', LAST_WEEK));
		await page.getByRole('link', { name: 'Next week' }).click();
		await expect(page.getByText('Week 1, 2033')).toBeVisible();
		const next = new URL(page.url());
		expect(next.searchParams.get('week_view')).toBe(FIRST_WEEK);
		expect(next.searchParams.get('fair_weekly_summary')).toBe(
			'community-week'
		);
		expect(
			await page.locator('.fair-weekly-summary__text').inputValue()
		).toBe(await blockSummary(page, slug, FIRST_WEEK));

		await page.goto(operatorPath(slug, 'community-week', FIRST_WEEK));
		await page.getByRole('link', { name: 'Previous week' }).click();
		await expect(page.getByText('Week 53, 2032')).toBeVisible();
	});

	test('falls back to the current week for a missing or invalid week', async ({
		page,
	}) => {
		const { slug } = fixtures.barcelona;
		const current = await blockSummary(page, slug);

		expect(await operatorSummary(page, slug, 'community-week')).toBe(
			current
		);
		await expect(page.getByText('is not a valid week')).toHaveCount(0);

		for (const invalid of ['2027-W53', 'next-week']) {
			expect(
				await operatorSummary(page, slug, 'community-week', invalid)
			).toBe(current);
			await expect(
				page.getByText(`“${invalid}” is not a valid week`)
			).toBeVisible();
		}
	});

	test('explains an empty week and keeps the heading-only summary', async ({
		page,
	}) => {
		const { slug } = fixtures.valencia;
		const expected = await blockSummary(page, slug, EMPTY_WEEK);

		await page.goto(operatorPath(slug, 'community-week', EMPTY_WEEK));
		await expect(
			page.getByText('There are no public events this week.')
		).toBeVisible();
		const text = await page
			.locator('.fair-weekly-summary__text')
			.inputValue();
		expect(text).toBe(expected);
		expect(text.split('\n')).toHaveLength(1);
		await expect(
			page.getByRole('button', { name: 'Copy summary' })
		).toBeEnabled();
	});

	test('refuses links that could show the wrong or a non-public calendar', async ({
		page,
	}) => {
		const cases = [
			[fixtures.valencia.slug, 'unknown-anchor', 'no events calendar'],
			[fixtures.duplicate, 'twice', 'More than one events calendar'],
			[fixtures.drafts, 'with-drafts', 'also shows draft events'],
			[fixtures.protectedPage, 'community-week', 'not public'],
			[fixtures.privatePage, 'community-week', 'doesn’t point to a page'],
		];
		for (const [slug, anchor, message] of cases) {
			const response = await page.goto(operatorPath(slug, anchor, WEEK));
			expect(response.status()).toBe(404);
			await expect(page.getByRole('alert')).toContainText(message);
			await expect(
				page.locator('.fair-weekly-summary__text')
			).toHaveCount(0);
		}

		// A logged-in organizer can open the private page, but not as a
		// public summary.
		await loginAsAdmin(page);
		const response = await page.goto(
			operatorPath(fixtures.privatePage, 'community-week', WEEK)
		);
		expect(response.status()).toBe(404);
		await expect(page.getByRole('alert')).toContainText('not public');
	});

	test('copies the summary to the clipboard', async ({ page, context }) => {
		await context.grantPermissions(['clipboard-read', 'clipboard-write']);
		const { slug } = fixtures.valencia;
		const expected = await blockSummary(page, slug, WEEK);
		const requests = [];
		await page.goto(operatorPath(slug, 'community-week', WEEK));
		page.on('request', (request) => {
			if (request.method() !== 'GET') {
				requests.push(`${request.method()} ${request.url()}`);
			}
		});

		await page.getByRole('button', { name: 'Copy summary' }).click();

		await expect(page.getByRole('status')).toHaveText(
			'Summary copied. Paste it into your message.'
		);
		expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
			expected
		);
		// Copying is local: nothing is posted anywhere.
		expect(requests).toEqual([]);
	});

	test('offers manual copying when the clipboard is unavailable', async ({
		page,
	}) => {
		await page.addInitScript(() => {
			Object.defineProperty(navigator, 'clipboard', {
				value: {
					writeText: () =>
						Promise.reject(
							new DOMException('Denied', 'NotAllowedError')
						),
				},
			});
		});
		const { slug } = fixtures.valencia;
		await page.goto(operatorPath(slug, 'community-week', WEEK));

		await page.getByRole('button', { name: 'Copy summary' }).click();

		await expect(page.getByRole('status')).toContainText(
			'Couldn’t copy automatically.'
		);
		const textarea = page.locator('.fair-weekly-summary__text');
		await expect(textarea).toBeFocused();
		const selected = await textarea.evaluate((el) =>
			el.value.slice(el.selectionStart, el.selectionEnd)
		);
		expect(selected).toBe(await textarea.inputValue());
	});

	test('fits a phone screen without horizontal scrolling', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		const { slug, titles } = fixtures.valencia;
		await page.goto(operatorPath(slug, 'community-week', WEEK));

		await expect(page.getByText(titles.apostrophe).first()).toBeVisible();
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth >
				document.documentElement.clientWidth
		);
		expect(overflow).toBe(false);
		const button = await page
			.getByRole('button', { name: 'Copy summary' })
			.boundingBox();
		expect(button.width).toBeGreaterThan(300);
	});
});
