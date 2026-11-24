/**
 * Event images in Manage Event (#2397).
 *
 * Uploads two images through the Media Library from the Images tab,
 * reorders them, saves, marks a focal circle on one of them, saves again
 * and checks that the order and the circle survive a reload. Also checks
 * that the tab is absent while the `event-images` bundle is off.
 *
 * Run: `npm run test:e2e:local -- e2e/fair-events-experimental-event-images.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';
import { setExperimentalFeature } from './support/experimental-features.js';
import { png } from './support/png.js';

const manageUrl = (id) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${id}&tab=images`;

async function apiFetch(page, options) {
	await page.waitForFunction(() => typeof window.wp?.apiFetch === 'function');
	return page.evaluate((opts) => window.wp.apiFetch(opts), options);
}

test.describe('Event images', () => {
	test.describe.configure({ mode: 'serial' });

	const suffix = `${Date.now()}`;
	const names = [`e2e-images-first-${suffix}`, `e2e-images-second-${suffix}`];
	let previous;
	let eventDateId;

	test.beforeAll(() => {
		previous = setExperimentalFeature('event-images', true);
	});

	test.afterAll(() => {
		setExperimentalFeature('event-images', previous);
		if (eventDateId) {
			wpCli(
				`eval 'FairEvents\\Models\\EventDates::delete_by_id( ${Number(
					eventDateId
				)} );'`,
				{ allowFailure: true }
			);
		}
		for (const name of names) {
			wpCli(
				`eval 'foreach ( get_posts( array( "post_type" => "attachment", "post_status" => "any", "title" => "${name}", "fields" => "ids" ) ) as $id ) { wp_delete_attachment( $id, true ); }'`,
				{ allowFailure: true }
			);
		}
	});

	test('upload, order and a focal circle survive a reload', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-manage-event');
		const created = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Images event ${suffix}`,
				start_date: '2035-06-01',
				end_date: '2035-06-01',
			},
		});
		eventDateId = created.id;

		await page.goto(manageUrl(eventDateId));
		await expect(
			page.getByText('No event images yet.', { exact: false })
		).toBeVisible();

		await page.getByRole('button', { name: 'Add images' }).click();
		const modal = page.locator('.media-modal:visible');
		await expect(modal).toBeVisible();
		await modal.locator('input[type="file"]').setInputFiles([
			{
				name: `${names[0]}.png`,
				mimeType: 'image/png',
				buffer: png(320, 160, [200, 60, 60]),
			},
			{
				name: `${names[1]}.png`,
				mimeType: 'image/png',
				buffer: png(160, 160, [60, 60, 200]),
			},
		]);
		// Both uploads finish and are selected.
		await expect(
			modal.locator('.attachments .attachment.selected:not(.uploading)')
		).toHaveCount(2, { timeout: 30000 });
		await modal.locator('.media-button-select').click();

		await expect(
			page.getByRole('heading', { name: `1. ${names[0]}` })
		).toBeVisible();
		await page.getByRole('button', { name: `Move ${names[1]} up` }).click();
		await expect(
			page.getByRole('heading', { name: `1. ${names[1]}` })
		).toBeVisible();

		await page.getByRole('button', { name: 'Save event images' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Event images saved.')
		).toBeVisible();

		// Now saved, the 320 × 160 image can take a circle.
		const wideCard = page.locator('.fair-events-images-card', {
			has: page.getByRole('heading', { name: `2. ${names[0]}` }),
		});
		await expect(wideCard.getByText('320 × 160 px')).toBeVisible();
		await wideCard
			.getByRole('button', { name: 'Mark focal region' })
			.click();
		await wideCard
			.getByRole('spinbutton', {
				name: 'Circle centre, from the left (%)',
			})
			.fill('30');
		await page.getByRole('button', { name: 'Save event images' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Event images saved.')
		).toBeVisible();

		await page.reload();
		await expect(
			page.getByRole('heading', { name: `1. ${names[1]}` })
		).toBeVisible();
		const reloaded = page.locator('.fair-events-images-card', {
			has: page.getByRole('heading', { name: `2. ${names[0]}` }),
		});
		await expect(
			reloaded.getByText('Focal region set', { exact: false })
		).toBeVisible();
		await expect(reloaded.getByTestId('focal-circle')).toHaveAttribute(
			'style',
			/left: 30%/
		);
		await expect(
			reloaded.getByRole('spinbutton', {
				name: 'Circle radius, % of the shorter side',
			})
		).toHaveValue('25');
		await expect(page.getByText('No unsaved changes.')).toBeVisible();
	});

	test('the tab is absent while the bundle is off', async ({ page }) => {
		setExperimentalFeature('event-images', false);
		try {
			await loginAsAdmin(page);
			await page.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${eventDateId}`
			);
			await expect(
				page.getByRole('tab', { name: 'Event Details' })
			).toBeVisible();
			await expect(page.getByRole('tab', { name: 'Images' })).toHaveCount(
				0
			);
		} finally {
			setExperimentalFeature('event-images', true);
		}
	});
});
