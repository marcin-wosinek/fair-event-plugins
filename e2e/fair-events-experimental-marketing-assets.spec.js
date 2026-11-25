/**
 * Marketing assets in Manage Event (#2396).
 *
 * Creates a text-only asset with exact multi-line text, then an image
 * asset uploaded through the Media Library, edits it, and deletes it after
 * a confirmation that names it, checking that the attachment stays in the
 * Media Library. Also checks that the Marketing tab is absent while the
 * `marketing-assets` bundle is off.
 *
 * Public sharing (#2430): links a team member after confirming their name
 * becomes public, then, as an anonymous visitor, opens the date's page from
 * the index, filters by member and use case, copies a text exactly and
 * downloads an image, at desktop, tablet and mobile widths.
 *
 * Run: `npm run test:e2e:local -- e2e/fair-events-experimental-marketing-assets.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { png } from './support/png.js';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';
import { setExperimentalFeature } from './support/experimental-features.js';

const manageUrl = (id) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${id}&tab=marketing-assets`;

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
	let previousTeam;
	let eventDateId;
	let sharedEventDateId;
	let memberId;

	test.beforeAll(() => {
		previous = setExperimentalFeature('marketing-assets', true);
		previousTeam = setExperimentalFeature('team-members', true);
	});

	test.afterAll(() => {
		setExperimentalFeature('marketing-assets', previous);
		setExperimentalFeature('team-members', previousTeam);
		for (const id of [eventDateId, sharedEventDateId].filter(Boolean)) {
			wpCli(
				`eval 'FairEvents\\Models\\EventDates::delete_by_id( ${Number(
					id
				)} );'`,
				{ allowFailure: true }
			);
		}
		if (memberId) {
			wpCli(
				`eval 'global $wpdb; $wpdb->delete( $wpdb->prefix . "fair_events_team_memberships", array( "member_id" => ${Number(
					memberId
				)} ) ); $wpdb->delete( $wpdb->prefix . "fair_events_team_members", array( "id" => ${Number(
					memberId
				)} ) );'`,
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

	test('share assets on a public page anyone can use', async ({
		page,
		browser,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-manage-event');
		const title = `Shared marketing ${suffix}`;
		const created = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: { title, start_date: '2035-07-08', end_date: '2035-07-08' },
		});
		sharedEventDateId = created.id;
		const member = await apiFetch(page, {
			path: '/fair-events/v1/team-members',
			method: 'POST',
			data: { name: `Ana${suffix}`, surname: 'Ruiz' },
		});
		memberId = member.id;
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${sharedEventDateId}/team-members`,
			method: 'POST',
			data: { member_id: memberId },
		});
		const memberName = `Ana${suffix} Ruiz`;

		// Linking a member needs consent to publish their name.
		await page.goto(manageUrl(sharedEventDateId));
		const shareLink = page.getByRole('link', { name: 'Open public page' });
		await expect(shareLink).toHaveAttribute(
			'href',
			new RegExp(`fair_marketing_assets=${sharedEventDateId}$`)
		);
		const shareUrl = await shareLink.getAttribute('href');
		const text = 'Ven al taller 🎉\n\n\tPlazas: 20  \n<b>not bold</b>';
		await page.getByRole('button', { name: 'Add asset' }).click();
		await expect(
			notice(page, /is shown on this date’s public marketing assets page/)
		).toBeVisible();
		await page
			.getByRole('textbox', { name: 'Use case' })
			.fill('Instagram post');
		await page
			.getByRole('textbox', { name: 'Text', exact: true })
			.fill(text);
		await page.getByRole('checkbox', { name: memberName }).check();
		const create = page.getByRole('button', { name: 'Create asset' });
		await expect(create).toHaveAttribute('aria-disabled', 'true');
		await page
			.getByRole('checkbox', {
				name: 'Show these names on the public marketing assets page',
			})
			.check();
		await create.click();
		await expect(notice(page, 'Created Instagram post.')).toBeVisible();
		await expect(page.getByText(`Team: ${memberName}`)).toBeVisible();

		// An image-only asset, uploaded through the media route.
		const image = await page.evaluate(
			async ({ base64, name }) => {
				const bytes = Uint8Array.from(atob(base64), (c) =>
					c.charCodeAt(0)
				);
				return window.wp.apiFetch({
					path: '/wp/v2/media',
					method: 'POST',
					body: new Blob([bytes], { type: 'image/png' }),
					headers: {
						'Content-Type': 'image/png',
						'Content-Disposition': `attachment; filename="${name}.png"`,
					},
				});
			},
			{ base64: png(40, 40).toString('base64'), name: imageName }
		);
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${sharedEventDateId}/marketing-assets`,
			method: 'POST',
			data: { label: 'WhatsApp status', attachment_id: image.id },
		});

		// An anonymous visitor finds the page in the index.
		const visitor = await browser.newContext();
		await visitor.grantPermissions(['clipboard-read', 'clipboard-write']);
		const pub = await visitor.newPage();
		try {
			await pub.goto('/?fair_marketing_assets=all');
			await pub.getByRole('link', { name: title }).click();
			await expect(pub).toHaveURL(shareUrl);
			await expect(pub.getByRole('heading', { level: 1 })).toHaveText(
				title
			);
			await expect(pub.getByText('2 assets')).toBeVisible();

			// Copying keeps the text exactly, markup-like text included.
			const post = pub.locator('.fair-marketing-assets__card', {
				has: pub.getByRole('heading', { name: 'Instagram post' }),
			});
			await expect(post.getByText(`With ${memberName}`)).toBeVisible();
			await post.getByRole('button', { name: 'Copy text' }).click();
			await expect(post.getByText('Text copied.')).toBeVisible();
			expect(
				await pub.evaluate(() => navigator.clipboard.readText())
			).toBe(text);

			// Downloading saves the PNG itself.
			const status = pub.locator('.fair-marketing-assets__card', {
				has: pub.getByRole('heading', { name: 'WhatsApp status' }),
			});
			const [download] = await Promise.all([
				pub.waitForEvent('download'),
				status.getByRole('link', { name: 'Download image' }).click(),
			]);
			expect(download.suggestedFilename()).toMatch(/\.png$/);
			const saved = await download.createReadStream();
			const chunks = [];
			for await (const chunk of saved) {
				chunks.push(chunk);
			}
			expect(Buffer.concat(chunks).subarray(0, 8)).toEqual(
				png(1, 1).subarray(0, 8)
			);

			// Filters narrow the list and clear again.
			await pub
				.getByLabel('Team member')
				.selectOption({ label: memberName });
			await expect(
				pub.getByText('1 asset matches the filters.')
			).toBeVisible();
			await expect(
				pub.getByRole('heading', { name: 'WhatsApp status' })
			).toHaveCount(0);
			await pub
				.getByLabel('Use case')
				.selectOption({ label: 'WhatsApp status' });
			await expect(
				pub.getByText('No assets match these filters.')
			).toBeVisible();
			await pub
				.getByRole('button', { name: 'Clear filters' })
				.first()
				.click();
			await expect(pub.getByText('2 assets')).toBeVisible();

			// The page fits desktop, tablet and mobile widths.
			for (const width of [1280, 768, 375]) {
				await pub.setViewportSize({ width, height: 900 });
				expect(
					await pub.evaluate(
						() =>
							document.documentElement.scrollWidth <=
							window.innerWidth
					)
				).toBe(true);
				await expect(
					post.getByRole('button', { name: 'Copy text' })
				).toBeVisible();
			}
		} finally {
			await visitor.close();
		}
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
