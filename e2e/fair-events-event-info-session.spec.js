/**
 * E2E: Event Info shows the selected session, an ended state, the recurring
 * overview, and an unavailable state (#1884).
 *
 * Every page is loaded with JavaScript disabled, so each assertion is about
 * the initial server-rendered HTML. Fixtures (series with overrides, a single
 * event, a page linked to one session) come from
 * seed-event-info-sessions.php, which also switches the site to
 * Europe/Madrid for the run. Status boundaries themselves (DST, overnight,
 * all-day, exact end/midnight) are covered by SessionStatusTest.
 *
 * Run: `npm run test:e2e:local -- e2e/fair-events-event-info-session.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { runScript } from './support/wp-cli.js';

const INFO = '.wp-block-fair-events-event-info';
const ENDED = 'This session has ended';
const UNAVAILABLE = 'This session is unavailable';

/** @type {object} */
let seed;
/** @type {import('@playwright/test').BrowserContext} */
let context;

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
	seed = runScript('seed-event-info-sessions.php', 'E2E_SEED', 'seed');
	context = await browser.newContext({ javaScriptEnabled: false });
});

test.afterAll(async () => {
	await context?.close();
	if (seed) {
		runScript(
			'seed-event-info-sessions.php',
			'E2E_CLEANUP',
			`cleanup '${JSON.stringify(seed)}'`
		);
	}
});

/**
 * Open a URL (optionally with `event_date`) without JavaScript and return the
 * Event Info block locator.
 *
 * @param {string}      url       Page URL.
 * @param {string|null} eventDate Raw `event_date` query string value.
 * @return {Promise<import('@playwright/test').Locator>} Event Info block.
 */
async function openInfo(url, eventDate = null) {
	const page = await context.newPage();
	const target =
		null === eventDate
			? url
			: `${url}${url.includes('?') ? '&' : '?'}${eventDate}`;
	const response = await page.goto(target);
	expect(response.status()).toBe(200);
	return page.locator(INFO);
}

/**
 * Assert a session view: own date with year, status, and the overview link.
 *
 * @param {import('@playwright/test').Locator} info  Event Info block.
 * @param {object}                             opts  Expectations.
 */
async function expectSession(info, { label, ended, address }) {
	if (label) {
		await expect(
			info.locator('.wp-block-fair-events-event-info__dates')
		).toHaveText(label);
	}
	const status = info.locator('.wp-block-fair-events-event-info__status');
	if (ended) {
		await expect(status).toHaveText(ENDED);
	} else {
		await expect(status).toHaveCount(0);
	}
	if (address) {
		await expect(
			info.locator('.wp-block-fair-events-event-info__venue-address')
		).toHaveText(address);
	}
	const link = info.locator(
		'.wp-block-fair-events-event-info__overview-link a'
	);
	await expect(link).toHaveText('View recurring event');
	await expect(link).toHaveAttribute('href', seed.seriesUrl);
}

/**
 * Assert the unavailable state: no details, only the status and a link.
 *
 * @param {import('@playwright/test').Locator} info     Event Info block.
 * @param {string}                             linkText Expected link label.
 * @param {string}                             href     Expected link target.
 */
async function expectUnavailable(info, linkText, href) {
	await expect(
		info.locator('.wp-block-fair-events-event-info__status')
	).toHaveText(UNAVAILABLE);
	await expect(
		info.locator('.wp-block-fair-events-event-info__dates')
	).toHaveCount(0);
	await expect(
		info.locator('.wp-block-fair-events-event-info__venue')
	).toHaveCount(0);
	const link = info.locator(
		'.wp-block-fair-events-event-info__overview-link a'
	);
	await expect(link).toHaveText(linkText);
	await expect(link).toHaveAttribute('href', href);
}

test('recurring page without a selection shows the overview', async () => {
	const info = await openInfo(seed.seriesUrl);

	await expect(
		info.locator('.wp-block-fair-events-event-info__dates')
	).toHaveText(/^\s*Every \w+, 19:00—20:30\s*$/);
	await expect(
		info.locator('.wp-block-fair-events-event-info__next-occurrence')
	).toHaveText(/^\s*Next: /);
	await expect(
		info.locator('.wp-block-fair-events-event-info__venue-address')
	).toHaveText('Calle Serie 1, Madrid');
	await expect(
		info.locator('.wp-block-fair-events-event-info__status')
	).toHaveCount(0);
	await expect(
		info.locator('.wp-block-fair-events-event-info__overview-link')
	).toHaveCount(0);
});

test('the first session (the series master) is a session, not the overview', async () => {
	const { first } = seed.sessions;
	const info = await openInfo(seed.seriesUrl, `event_date=${first.date}`);

	await expectSession(info, {
		label: first.label,
		ended: true,
		address: 'Calle Serie 1, Madrid',
	});
});

test('a past generated session keeps its details and shows it ended', async () => {
	const { past } = seed.sessions;

	for (const param of [`event_date=${past.date}`, `event_date=${past.id}`]) {
		const info = await openInfo(seed.seriesUrl, param);
		await expectSession(info, {
			label: past.label,
			ended: true,
			address: 'Calle Serie 1, Madrid',
		});
	}
});

test("a session's own time and address overrides are shown", async () => {
	const { override } = seed.sessions;
	const info = await openInfo(seed.seriesUrl, `event_date=${override.date}`);

	await expectSession(info, {
		label: override.label,
		ended: false,
		address: 'Calle Cambio 2, Madrid',
	});
});

test("a session's own attendance mode is shown", async () => {
	const { online } = seed.sessions;
	const info = await openInfo(seed.seriesUrl, `event_date=${online.date}`);

	await expect(
		info.locator('.wp-block-fair-events-event-info__attendance-mode')
	).toContainText('Online event');
	await expectSession(info, { ended: false });
});

test("today's session without an end time is not ended before midnight", async () => {
	const { today } = seed.sessions;
	const info = await openInfo(seed.seriesUrl, `event_date=${today.date}`);

	await expectSession(info, { ended: false });
});

test('invalid and unrelated selections are unavailable, never another session', async () => {
	for (const param of [
		'event_date=2001-01-01',
		'event_date=not-a-date',
		'event_date=',
		'event_date[]=x',
		`event_date=${seed.singleDate}`,
		`event_date=${seed.singleEventDateId}`,
	]) {
		const info = await openInfo(seed.seriesUrl, param);
		await expectUnavailable(info, 'View recurring event', seed.seriesUrl);
	}
});

test('a page linked directly to one session shows that session', async () => {
	const { past } = seed.sessions;
	const info = await openInfo(seed.linkedUrl);

	await expectSession(info, {
		label: past.label,
		ended: true,
		address: 'Calle Serie 1, Madrid',
	});
});

test('a single event is unchanged, and only its own date is a valid selection', async () => {
	for (const param of [null, `event_date=${seed.singleDate}`]) {
		const info = await openInfo(seed.singleUrl, param);
		await expect(
			info.locator('.wp-block-fair-events-event-info__dates')
		).toContainText('10:00—12:00');
		await expect(
			info.locator('.wp-block-fair-events-event-info__venue-address')
		).toHaveText('Calle Sola 3, Madrid');
		await expect(
			info.locator('.wp-block-fair-events-event-info__status')
		).toHaveCount(0);
		await expect(
			info.locator('.wp-block-fair-events-event-info__overview-link')
		).toHaveCount(0);
	}

	const info = await openInfo(
		seed.singleUrl,
		`event_date=${seed.sessions.first.date}`
	);
	await expectUnavailable(info, 'View event', seed.singleUrl);
});
