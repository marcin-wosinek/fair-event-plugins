/**
 * Fair Events Experimental's event feed calendar and public event proposal
 * messages are translated (#1872) and stay in English on an English site.
 *
 * Their strings used to sit in Fair Events' catalog, which isn't loaded for
 * this plugin's bundles or replies, so they rendered in English on a
 * translated site. The plugin always loads its bundled catalog, so only the
 * locale changes here.
 *
 * Needs a current `npm run makemo` and `npm run build` in
 * fair-events-experimental.
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from './support/wp-cli.js';

const SOURCES_PAGE = '/wp-admin/admin.php?page=fair-events-sources';
const SOURCE_VIEW_PAGE =
	'/wp-admin/admin.php?page=fair-events-source-view&source_id=';
const PROPOSALS_ROUTE = '/wp-json/fair-events/v1/event-proposals';

const TEXT = {
	en: {
		calendarNav: ['Previous', 'Today', 'Next'],
		pastStart: 'Event start date must be in the future.',
	},
	es: {
		calendarNav: ['Anterior', 'Hoy', 'Siguiente'],
		pastStart: 'La fecha de inicio del evento debe ser en el futuro.',
	},
};

const setLocale = (mode) =>
	runScript(
		'translation-delivery.php',
		'E2E_TRANSLATIONS',
		`${mode} es_ES fair-events-experimental`
	);

/** Call the REST API from an admin page, so apiFetch sends the nonce. */
const adminApiFetch = (page, options) =>
	page.evaluate((opts) => window.wp.apiFetch(opts), options);

let sourceId = null;

async function expectScreens(page, request, text) {
	await page.goto(`${SOURCE_VIEW_PAGE}${sourceId}`);
	for (const label of text.calendarNav) {
		await expect(page.getByRole('button', { name: label })).toBeVisible({
			timeout: 20_000,
		});
	}

	// Public endpoint, called anonymously like the event-proposal block.
	const response = await request.post(PROPOSALS_ROUTE, {
		data: {
			title: 'E2E past proposal',
			start_datetime: '2020-01-01T10:00:00',
			duration_minutes: 60,
			location: 'E2E Hall',
			submitter_name: 'E2E Visitor',
			submitter_email: 'e2e-visitor@example.com',
		},
	});
	expect(response.status()).toBe(400);
	expect((await response.json()).message).toBe(text.pastStart);
}

test.describe('Fair Events Experimental translations', () => {
	test.setTimeout(120_000);

	test.beforeAll(async ({ browser }) => {
		// Default bundles: event feeds are on.
		wpCli('option delete fair_events_experimental_features');
		setLocale('reset');

		const page = await browser.newPage();
		await loginAsAdmin(page);
		await page.goto(SOURCES_PAGE);
		const source = await adminApiFetch(page, {
			path: '/fair-events/v1/sources',
			method: 'POST',
			data: {
				name: `E2E translations feed ${Date.now()}`,
				data_sources: [
					{ source_type: 'categories', config: { category_ids: [] } },
				],
			},
		});
		sourceId = source.id;
		await page.close();
	});

	test.afterAll(async ({ browser }) => {
		setLocale('reset');
		if (sourceId) {
			const page = await browser.newPage();
			await loginAsAdmin(page);
			await page.goto(SOURCES_PAGE);
			await adminApiFetch(page, {
				path: `/fair-events/v1/sources/${sourceId}`,
				method: 'DELETE',
			});
			await page.close();
		}
	});

	test('Spanish screens from the bundled catalog', async ({
		page,
		request,
	}) => {
		const result = setLocale('bundled');
		expect(result.plugin).toBe('fair-events-experimental');

		await loginAsAdmin(page);
		await expectScreens(page, request, TEXT.es);
	});

	test('English screens on an English site', async ({ page, request }) => {
		setLocale('reset');

		await loginAsAdmin(page);
		await expectScreens(page, request, TEXT.en);
	});
});
