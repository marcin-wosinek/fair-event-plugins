/**
 * Marketing assets in Manage Event (#2396).
 *
 * Creates a text-only asset with exact multi-line text, then an image
 * asset uploaded through the Media Library, edits it, and deletes it after
 * a confirmation that names it, checking that the attachment stays in the
 * Media Library. Also checks that the Marketing tab is absent while the
 * `marketing-assets` bundle is off.
 *
 * Run: `npm run test:e2e:local -- e2e/fair-events-experimental-marketing-assets.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { deflateSync } from 'node:zlib';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';
import { setExperimentalFeature } from './support/experimental-features.js';

const manageUrl = (id) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${id}&tab=marketing-assets`;

/** A solid-colour PNG of the given size. */
function png(width, height) {
	const crcTable = Array.from({ length: 256 }, (_, n) => {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		return c >>> 0;
	});
	const crc = (buf) => {
		let c = 0xffffffff;
		for (const byte of buf) {
			c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
		}
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const len = Buffer.alloc(4);
		len.writeUInt32BE(data.length);
		const body = Buffer.concat([Buffer.from(type), data]);
		const sum = Buffer.alloc(4);
		sum.writeUInt32BE(crc(body));
		return Buffer.concat([len, body, sum]);
	};
	const header = Buffer.alloc(13);
	header.writeUInt32BE(width, 0);
	header.writeUInt32BE(height, 4);
	header[8] = 8;
	header[9] = 2;
	const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 90)]);
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', header),
		chunk('IDAT', deflateSync(Buffer.concat(Array(height).fill(row)))),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

async function apiFetch(page, options) {
	await page.waitForFunction(() => typeof window.wp?.apiFetch === 'function');
	return page.evaluate((opts) => window.wp.apiFetch(opts), options);
}

const notice = (page, text) =>
	page.locator('.components-notice__content').getByText(text);

test.describe('Marketing assets', () => {
	test.describe.configure({ mode: 'serial' });

	const suffix = `${Date.now()}`;
	const imageName = `e2e-marketing-${suffix}`;
	let previous;
	let eventDateId;

	test.beforeAll(() => {
		previous = setExperimentalFeature('marketing-assets', true);
	});

	test.afterAll(() => {
		setExperimentalFeature('marketing-assets', previous);
		if (eventDateId) {
			wpCli(
				`eval 'FairEvents\\Models\\EventDates::delete_by_id( ${Number(
					eventDateId
				)} );'`,
				{ allowFailure: true }
			);
		}
		wpCli(
			`eval 'foreach ( get_posts( array( "post_type" => "attachment", "post_status" => "any", "title" => "${imageName}", "fields" => "ids" ) ) as $id ) { wp_delete_attachment( $id, true ); }'`,
			{ allowFailure: true }
		);
	});

	test('create, edit and delete assets with text and an image', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-manage-event');
		const created = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Marketing event ${suffix}`,
				start_date: '2035-07-01',
				end_date: '2035-07-01',
			},
		});
		eventDateId = created.id;

		await page.goto(manageUrl(eventDateId));
		await expect(
			page.getByText('No marketing assets for this date yet.', {
				exact: false,
			})
		).toBeVisible();

		// Text-only asset; the text keeps its line breaks and spacing.
		const text = 'Hola 👋\n\n  See you at 7 pm\n– the team';
		await page.getByRole('button', { name: 'Add asset' }).click();
		await page
			.getByRole('textbox', { name: 'Use case' })
			.fill('WhatsApp group message');
		await page
			.getByRole('textbox', { name: 'Text', exact: true })
			.fill(text);
		await page.getByRole('button', { name: 'Create asset' }).click();
		await expect(
			notice(page, 'Created WhatsApp group message.')
		).toBeVisible();

		await page.reload();
		const preview = page.locator('.fair-events-marketing-text-preview');
		await expect(preview).toHaveCount(1);
		// WordPress swaps emoji for images in admin, so compare the visible
		// lines here and the exact text through the API.
		await expect(preview).toContainText('  See you at 7 pm\n– the team');
		const listed = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDateId}/marketing-assets`,
		});
		expect(listed.items[0].text).toBe(text);

		// Image asset: the visibility note is shown before the Media Library opens.
		await page.getByRole('button', { name: 'Add asset' }).click();
		await expect(
			notice(page, /Anyone with an image’s link can open it/)
		).toBeVisible();
		await page
			.getByRole('textbox', { name: 'Use case' })
			.fill('Instagram post');
		await page
			.getByRole('button', { name: 'Choose or upload image' })
			.click();
		const modal = page.locator('.media-modal:visible');
		await expect(modal).toBeVisible();
		await modal.locator('input[type="file"]').setInputFiles({
			name: `${imageName}.png`,
			mimeType: 'image/png',
			buffer: png(200, 200),
		});
		await expect(
			modal.locator('.attachments .attachment.selected:not(.uploading)')
		).toHaveCount(1, { timeout: 30000 });
		await modal.locator('.media-button-select').click();
		await expect(page.getByText(imageName)).toBeVisible();
		await page.getByRole('button', { name: 'Create asset' }).click();
		await expect(notice(page, 'Created Instagram post.')).toBeVisible();

		const card = page.locator('.fair-events-marketing-card', {
			has: page.getByRole('heading', { name: 'Instagram post' }),
		});
		await expect(card.locator('img')).toBeVisible();

		// Edit: add a caption.
		await page.getByRole('button', { name: 'Edit Instagram post' }).click();
		await page
			.getByRole('textbox', { name: 'Text', exact: true })
			.fill('Caption');
		await page.getByRole('button', { name: 'Save asset' }).click();
		await expect(notice(page, 'Saved Instagram post.')).toBeVisible();
		await expect(card.getByText('Caption')).toBeVisible();

		// Delete: the confirmation names the asset and keeps the image.
		await page
			.getByRole('button', { name: 'Delete Instagram post' })
			.click();
		const dialog = page.getByRole('dialog');
		await expect(
			dialog.getByText('Delete marketing asset — Instagram post')
		).toBeVisible();
		await expect(
			dialog.getByText('The image stays in the Media Library', {
				exact: false,
			})
		).toBeVisible();
		await dialog.getByRole('button', { name: 'Delete asset' }).click();
		await expect(
			notice(
				page,
				'Deleted Instagram post. Its image stays in the Media Library.'
			)
		).toBeVisible();
		await expect(
			page.getByRole('heading', { name: 'Instagram post' })
		).toHaveCount(0);

		const kept = wpCli(
			`eval 'echo count( get_posts( array( "post_type" => "attachment", "post_status" => "any", "title" => "${imageName}", "fields" => "ids" ) ) );'`
		).trim();
		expect(kept).toBe('1');
	});

	test('the tab is absent while the bundle is off', async ({ page }) => {
		setExperimentalFeature('marketing-assets', false);
		try {
			await loginAsAdmin(page);
			await page.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${eventDateId}`
			);
			await expect(
				page.getByRole('tab', { name: 'Event Details' })
			).toBeVisible();
			await expect(
				page.getByRole('tab', { name: 'Marketing' })
			).toHaveCount(0);
		} finally {
			setExperimentalFeature('marketing-assets', true);
		}
	});
});
