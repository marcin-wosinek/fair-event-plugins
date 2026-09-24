/**
 * The event gallery is retired (#1675).
 *
 * Covers the upgrade cleanup on an installation that still has gallery data
 * (including a repeated run), the 410 answer for old gallery links, the
 * retired REST routes, the removed Photos tab, and the retained photo
 * upload/tag routes of fair-audience-experimental's `photos` bundle.
 *
 * Run: `npm run test:e2e:local -- e2e/retired-gallery.spec.js`.
 */

import { test, expect } from './support/fixtures.js';
import { wpCli, runScript, loginAsAdmin } from './support/wp-cli.js';

const RETIRED_ROUTES = [
	'/fair-events/v1/event-dates/1/gallery',
	'/fair-events/v1/event-dates/1/gallery/download',
	'/fair-events/v1/photos/1/likes',
	'/fair-audience/v1/gallery-access/validate',
	'/fair-audience/v1/event-dates/1/gallery-invitations',
	'/fair-audience/v1/event-dates/1/gallery-invitations/stats',
];

// Probed with GET, so only readable routes of the `photos` bundle apply.
const RETAINED_PHOTO_ROUTES = ['/fair-audience/v1/photos/1/tags'];

async function routeIsRegistered(request, path) {
	const response = await request.get(`/wp-json${path}`);
	if (response.status() !== 404) {
		return true;
	}
	const body = await response.json().catch(() => null);
	return body?.code !== 'rest_no_route';
}

/** Any wp-cli call boots WordPress, which runs the pending upgrades. */
function readGalleryState(attachmentId) {
	return runScript(
		'retired-gallery-state.php',
		'E2E_STATE',
		String(attachmentId)
	);
}

test.describe('Retired event gallery', () => {
	test('upgrade removes gallery data, keeps media, and can repeat', () => {
		const seed = runScript('seed-retired-gallery.php', 'E2E_SEED');

		try {
			const state = readGalleryState(seed.attachmentId);

			expect(state.tables).toEqual({
				fair_events_event_photos: false,
				fair_events_photo_likes: false,
				fair_audience_gallery_access_keys: false,
			});
			expect(state.attachmentExists).toBe(true);
			expect(state.photoAuthorRows).toBe(1);
			expect(state.eventsDbVersion).toBe('3.36.0');
			expect(state.audienceDbVersion).toBe('1.44.0');
			expect(state.eventsFeatures).toEqual([]);
			expect(state.audienceFeatures).toEqual({ photos: true });

			// Rewind the versions: the cleanup runs again over clean data.
			wpCli('option update fair_events_db_version 3.35.0');
			wpCli('option update fair_audience_db_version 1.43.0');

			const repeated = readGalleryState(seed.attachmentId);
			expect(repeated.eventsDbVersion).toBe('3.36.0');
			expect(repeated.audienceDbVersion).toBe('1.44.0');
			expect(repeated.attachmentExists).toBe(true);
			expect(repeated.photoAuthorRows).toBe(1);
			expect(repeated.audienceFeatures).toEqual({ photos: true });
		} finally {
			runScript(
				'cleanup-retired-gallery.php',
				'E2E_CLEANUP',
				`${seed.attachmentId} ${seed.participantId}`
			);
		}
	});

	for (const path of [
		'/?gallery_key=e2eretiredtoken00000000000000000',
		'/?event_gallery_id=1',
		'/event-gallery/1/',
	]) {
		test(`old gallery link ${path} answers 410`, async ({ request }) => {
			const response = await request.get(path, { maxRedirects: 0 });
			expect(response.status()).toBe(410);
			expect(await response.text()).toContain(
				'This event photo gallery is no longer available.'
			);
		});
	}

	test('gallery REST routes are gone, photo routes remain', async ({
		request,
	}) => {
		for (const path of RETIRED_ROUTES) {
			expect(
				await routeIsRegistered(request, path),
				`${path} should be unregistered`
			).toBe(false);
		}
		for (const path of RETAINED_PHOTO_ROUTES) {
			expect(
				await routeIsRegistered(request, path),
				`${path} should stay registered`
			).toBe(true);
		}
	});

	test('manage-event page has no Photos tab', async ({ page, seedEvent }) => {
		const event = seedEvent('free');
		await loginAsAdmin(page);
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${event.eventDateId}`
		);

		await expect(
			page.getByRole('tab', { name: 'Event Details' })
		).toBeVisible();
		await expect(page.getByRole('tab', { name: 'Photos' })).toHaveCount(0);
	});
});
