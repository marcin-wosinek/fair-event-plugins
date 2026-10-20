/**
 * E2E: the Other Sessions block lists the upcoming sessions of a recurring
 * event on its overview and session pages, with accurate dates, only supplied
 * times, session venues, and links to each session's page (#1885).
 *
 * Visitor pages load with JavaScript disabled, so those assertions are about
 * the initial server-rendered HTML. Fixtures come from
 * seed-other-sessions.php, which also switches the site to Europe/Madrid for
 * the run. Exact end boundaries (DST, midnight, multi-day) are covered by
 * OtherSessionsTest.
 *
 * Run: `npm run test:e2e:local -- e2e/fair-events-other-sessions.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { runScript, loginAsAdmin } from './support/wp-cli.js';

const BLOCK = '.wp-block-fair-events-other-sessions';
const ITEM = '.wp-block-fair-events-other-sessions__item';
const DATE_LINK = 'a.wp-block-fair-events-other-sessions__date';

/** @type {object} */
let seed;
/** @type {import('@playwright/test').BrowserContext} */
let visitor;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
	seed = runScript('seed-other-sessions.php', 'E2E_SEED', 'seed');
	visitor = await browser.newContext({ javaScriptEnabled: false });
});

test.afterAll(async () => {
	await visitor?.close();
	if (seed) {
		runScript(
			'seed-other-sessions.php',
			'E2E_CLEANUP',
			`cleanup '${JSON.stringify(seed)}'`
		);
	}
});

/**
 * Open a page without JavaScript.
 *
 * @param {string} url Page URL.
 * @return {Promise<import('@playwright/test').Page>} Loaded page.
 */
async function openPage(url) {
	const page = await visitor.newPage();
	const response = await page.goto(url);
	expect(response.status()).toBe(200);
	return page;
}

/**
 * Assert the listed sessions, in order, by their date link label and target.
 *
 * @param {import('@playwright/test').Locator} block    Block locator.
 * @param {object[]}                           expected Expected sessions.
 */
async function expectSessions(block, expected) {
	const links = block.locator(DATE_LINK);
	await expect(links).toHaveText(expected.map((session) => session.label));
	for (const [index, session] of expected.entries()) {
		await expect(links.nth(index)).toHaveAttribute('href', session.href);
	}
}

test('overview lists the next five upcoming sessions with their details', async () => {
	const page = await openPage(seed.seriesUrl);
	const block = page.locator(BLOCK);
	const { today, midnight, endOnly, override, allDay } = seed.sessions;

	await expect(block.getByRole('navigation')).toHaveAttribute(
		'aria-label',
		'Upcoming sessions'
	);
	// Past, already-ended, cancelled and the sixth eligible session are left out.
	await expectSessions(block, [today, midnight, endOnly, override, allDay]);

	const items = block.locator(ITEM);
	await expect(items.nth(1)).toContainText(midnight.location);
	await expect(items.nth(2)).toContainText('Online event');
	await expect(items.nth(3)).toContainText(override.location);
	await expect(items.nth(4)).toContainText('All day');
	// Only the explicit all-day session is marked all day.
	await expect(block.getByText('All day', { exact: true })).toHaveCount(1);
});

test('a selected session is left out of its own page', async () => {
	const page = await openPage(
		`${seed.seriesUrl}?event_date=${seed.dates.midnight}`
	);
	const block = page.locator(BLOCK);
	const { today, endOnly, override, allDay, last } = seed.sessions;

	await expect(block.getByRole('navigation')).toHaveAttribute(
		'aria-label',
		'Other upcoming sessions'
	);
	await expectSessions(block, [today, endOnly, override, allDay, last]);
});

test('a page linked directly to one session leaves that session out', async () => {
	const page = await openPage(seed.sessionPageUrl);
	const { today, midnight, override, allDay, last } = seed.sessions;

	await expectSessions(page.locator(BLOCK), [
		today,
		midnight,
		override,
		allDay,
		last,
	]);
});

test('the block limit bounds the list', async () => {
	const page = await openPage(seed.limitedUrl);
	const { today, midnight } = seed.sessions;

	await expectSessions(page.locator(BLOCK), [today, midnight]);
});

test("a series' first session is listed and links to its dated page", async () => {
	const page = await openPage(seed.futureUrl);
	const links = page.locator(BLOCK).locator(DATE_LINK);

	await expect(links).toHaveCount(2);
	await expect(links.first()).toHaveText(seed.futureFirst.label);
	await expect(links.first()).toHaveAttribute('href', seed.futureFirst.href);
});

test('an invalid selection is reported and the list still helps', async () => {
	const page = await openPage(`${seed.seriesUrl}?event_date=2001-01-01`);
	const block = page.locator(BLOCK);

	await expect(
		block.locator('.wp-block-fair-events-other-sessions__status')
	).toHaveText('The selected session is unavailable.');
	await expect(block.locator(DATE_LINK)).toHaveCount(5);
});

test('a series with nothing left to attend says so', async () => {
	const page = await openPage(seed.endedUrl);
	const block = page.locator(BLOCK);

	await expect(
		block.locator('.wp-block-fair-events-other-sessions__empty')
	).toHaveText('There are no upcoming sessions.');
	await expect(block.getByRole('navigation')).toHaveCount(0);
});

test('single events and pages without an event render nothing', async () => {
	for (const url of [seed.singleUrl, seed.unlinkedUrl]) {
		const page = await openPage(url);
		await expect(page.locator(BLOCK)).toHaveCount(0);
	}
});

test('session links open the dated session page', async () => {
	const page = await openPage(seed.seriesUrl);
	const { override } = seed.sessions;

	// Go to the link's target rather than clicking (see e2e notes on stalls).
	const href = await page
		.locator(BLOCK)
		.locator(DATE_LINK)
		.nth(3)
		.getAttribute('href');
	const sessionPage = await openPage(href);

	await expect(
		sessionPage.locator('.wp-block-fair-events-event-info__dates')
	).toHaveText(override.label);
	await expect(
		sessionPage.locator('.wp-block-fair-events-event-info__venue-address')
	).toHaveText(override.location);
});

test('session links are reachable with the keyboard in order', async ({
	page,
}) => {
	await page.goto(seed.seriesUrl);
	const links = page.locator(BLOCK).locator(DATE_LINK);

	await links.first().focus();
	for (let index = 1; index < 5; index++) {
		await page.keyboard.press('Tab');
		await expect(links.nth(index)).toBeFocused();
	}
});

test('the editor previews the list and explains an unlinked page', async ({
	page,
}) => {
	await loginAsAdmin(page);

	for (const [postId, check] of [
		[
			seed.seriesPostId,
			(frame) =>
				expect(frame.locator(`${BLOCK} ${DATE_LINK}`)).toHaveCount(5),
		],
		[
			seed.unlinkedPostId,
			(frame) =>
				expect(
					frame.locator(
						'.wp-block-fair-events-other-sessions__editor-placeholder'
					)
				).toHaveText(
					'Other Sessions block is disabled — no event is linked to this post.'
				),
		],
	]) {
		await page.goto(`/wp-admin/post.php?post=${postId}&action=edit`);
		const frame = page.frameLocator('[name="editor-canvas"]');
		await frame.locator('.block-editor-iframe__body').waitFor();
		await check(frame);
	}
});
