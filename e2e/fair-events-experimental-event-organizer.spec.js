/**
 * Choosing an event's organizer in Fair Events Experimental (#2305).
 *
 * Covers selecting an organizer in Manage Event's Event Details (above
 * Categories, no Organizer tab), keeping it across a reload and an unsaved
 * choice across a tab switch, resetting to the sitewide default, an old
 * Organizer tab link opening Event Details, a series date showing its
 * series' organizer, choosing the organizer in the calendar's Create Event
 * popup, copying a page-backed event and a calendar-only series (the latter
 * while organizers are turned off), and the field disappearing from both
 * places while organizers are off with every assignment kept.
 *
 * Run: `npm run test:e2e:local -- e2e/fair-events-experimental-event-organizer.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';
import { setExperimentalFeature } from './support/experimental-features.js';

const OPTION_PREFIX = 'fair_events_experimental_organizer_';
const INDEX_OPTION = 'fair_events_experimental_organizer_ids';

const manageUrl = (id, tab) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${id}${
		tab ? `&tab=${tab}` : ''
	}`;

const organizerSelect = (page) =>
	page.getByRole('combobox', { name: 'Organizer' });

// The calendar toolbar's button; each day also has an "Add event" button.
const addEventButton = (page) =>
	page.getByRole('button', { name: 'Add event' }).first();

/** Raw organizer_id column of an event date row, '' when NULL. */
function storedOrganizerId(eventDateId) {
	const out = wpCli(
		`eval 'global $wpdb; echo "ORGANIZER:" . (string) $wpdb->get_var( $wpdb->prepare( "SELECT organizer_id FROM %i WHERE id = %d", $wpdb->prefix . "fair_event_dates", ${Number(
			eventDateId
		)} ) );'`
	);
	return out.match(/ORGANIZER:(\S*)/)[1];
}

/** The event date row a post is linked to. */
function eventDateIdForPost(postId) {
	const out = wpCli(
		`eval 'echo "EVENT_DATE:" . (int) FairEvents\\Models\\EventDates::get_by_event_id( ${Number(
			postId
		)} )->id;'`
	);
	return Number(out.match(/EVENT_DATE:(\d+)/)[1]);
}

async function apiFetch(page, options) {
	await page.waitForFunction(() => typeof window.wp?.apiFetch === 'function');
	const result = await page.evaluate(async (opts) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch(opts) };
		} catch (error) {
			return { ok: false, error: error?.message || String(error) };
		}
	}, options);
	if (!result.ok) {
		throw new Error(
			`${options.method || 'GET'} ${options.path}: ${result.error}`
		);
	}
	return result.data;
}

/**
 * Copy an event through the Copy Event screen; returns the redirect URL.
 * The screen's link is only listed in All Events, found by title.
 */
async function copyEvent(page, source, title) {
	const listed = await apiFetch(page, {
		path: `/fair-events/v1/event-dates/all?per_page=20&search=${encodeURIComponent(
			source.title
		)}`,
	});
	const found = listed.find((item) => item.id === source.id);
	expect(found?.copy_url).toBeTruthy();
	const copyUrl = found.copy_url;

	const screen = await (await page.request.get(copyUrl)).text();
	const nonce = screen.match(/name="copy_event_nonce" value="([^"]+)"/)?.[1];
	expect(nonce).toBeTruthy();

	const response = await page.request.post(copyUrl, {
		maxRedirects: 0,
		form: {
			copy_event_submit: 'Create Copy',
			copy_event_nonce: nonce,
			event_title: title,
			date_option: 'week',
			custom_date: '',
			start_time:
				screen.match(/name="start_time" value="([^"]*)"/)?.[1] ?? '',
			end_time:
				screen.match(/name="end_time" value="([^"]*)"/)?.[1] ?? '',
		},
	});
	expect(response.status()).toBe(302);
	return new URL(response.headers().location);
}

test.describe('Event organizer', () => {
	test.describe.configure({ mode: 'serial' });

	let north;
	let south;
	let pageEvent;
	let series;
	const eventDateIds = [];
	const postIds = [];

	test.beforeAll(async ({ browser }) => {
		// The bundle is off by default; this suite assigns organizers.
		setExperimentalFeature('organizers', true);

		const page = await browser.newPage();
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');

		await apiFetch(page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: { fair_events_organizer: { name: 'Sitewide Club' } },
		});
		north = await apiFetch(page, {
			path: '/fair-events/v1/organizers',
			method: 'POST',
			data: { name: 'North Club' },
		});
		south = await apiFetch(page, {
			path: '/fair-events/v1/organizers',
			method: 'POST',
			data: { name: 'South Club' },
		});

		const suffix = Date.now();
		const post = await apiFetch(page, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Organizer page event ${suffix}`,
				status: 'publish',
			},
		});
		postIds.push(post.id);
		const pageEventDate = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Organizer page event ${suffix}`,
				start_date: '2035-10-02',
				start_time: '18:00:00',
				end_date: '2035-10-02',
				end_time: '20:00:00',
			},
		});
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${pageEventDate.id}`,
			method: 'PUT',
			data: { event_id: post.id, link_type: 'post' },
		});
		pageEvent = {
			id: pageEventDate.id,
			postId: post.id,
			title: pageEventDate.title,
		};

		const seriesDate = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Organizer series ${suffix}`,
				start_date: '2035-10-06',
				start_time: '09:00:00',
				end_date: '2035-10-06',
				end_time: '10:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		});
		series = {
			id: seriesDate.id,
			title: seriesDate.title,
			occurrenceIds: (seriesDate.generated_occurrences || []).map(
				(o) => o.id
			),
		};
		eventDateIds.push(pageEvent.id, series.id, ...series.occurrenceIds);
		await page.close();
	});

	test.afterAll(async ({ browser }) => {
		setExperimentalFeature('organizers', undefined);
		const page = await browser.newPage();
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		for (const id of [...eventDateIds].reverse()) {
			await apiFetch(page, {
				path: `/fair-events/v1/event-dates/${id}`,
				method: 'DELETE',
			}).catch(() => {});
		}
		for (const id of postIds) {
			await apiFetch(page, {
				path: `/wp/v2/fair_event/${id}?force=true`,
				method: 'DELETE',
			}).catch(() => {});
		}
		await page.close();
		for (const organizer of [north, south].filter(Boolean)) {
			wpCli(`option delete ${OPTION_PREFIX}${organizer.id}`, {
				allowFailure: true,
			});
		}
		wpCli(`option delete ${INDEX_OPTION}`, { allowFailure: true });
		wpCli('option delete fair_events_organizer', { allowFailure: true });
	});

	test('selects, keeps, and resets an event organizer', async ({ page }) => {
		await loginAsAdmin(page);
		// An old Organizer tab link opens Event Details.
		await page.goto(manageUrl(pageEvent.id, 'organizer'));

		await expect(
			page.getByRole('tab', { name: 'Event Details', selected: true })
		).toBeVisible();
		expect(new URL(page.url()).searchParams.has('tab')).toBe(false);
		await expect(
			page.getByRole('tab', { name: /^Organizer/ })
		).toHaveCount(0);
		await expect(organizerSelect(page)).toHaveValue('default');

		// Placed directly above Categories.
		const followsOrganizer = await organizerSelect(page).evaluate(
			(select) => {
				const categories = document.querySelector(
					'.components-form-token-field'
				);
				return Boolean(
					categories &&
						select.compareDocumentPosition(categories) &
							Node.DOCUMENT_POSITION_FOLLOWING
				);
			}
		);
		expect(followsOrganizer).toBe(true);
		await expect(
			page.getByRole('option', {
				name: 'Sitewide default (Sitewide Club)',
			})
		).toHaveCount(1);

		// An unsaved choice marks Event Details and survives switching tabs.
		await organizerSelect(page).selectOption({ label: 'South Club' });
		await page.getByRole('tab', { name: 'Admin' }).click();
		await page.getByRole('tab', { name: 'Event Details •' }).click();
		await expect(organizerSelect(page)).toHaveValue(south.id);

		await organizerSelect(page).selectOption({ label: 'North Club' });
		await page.getByRole('button', { name: 'Save organizer' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Organizer saved.', { exact: true })
		).toBeVisible();

		await page.reload();
		await expect(organizerSelect(page)).toHaveValue(north.id);
		expect(storedOrganizerId(pageEvent.id)).toBe(north.id);

		await organizerSelect(page).selectOption('default');
		await page.getByRole('button', { name: 'Save organizer' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText(
					'Organizer saved. This event uses the sitewide organizer.'
				)
		).toBeVisible();
		await page.reload();
		await expect(organizerSelect(page)).toHaveValue('default');
		expect(storedOrganizerId(pageEvent.id)).toBe('');

		// Leave it assigned for the copy test.
		await organizerSelect(page).selectOption({ label: 'North Club' });
		await page.getByRole('button', { name: 'Save organizer' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Organizer saved.', { exact: true })
		).toBeVisible();
	});

	test('a series date shows the series organizer and links to the series', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(manageUrl(series.id));
		await organizerSelect(page).selectOption({ label: 'South Club' });
		await page.getByRole('button', { name: 'Save organizer' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Organizer saved.', { exact: true })
		).toBeVisible();

		await page.goto(manageUrl(series.occurrenceIds[0]));
		await expect(page.getByText('Organizer: South Club')).toBeVisible();
		await expect(organizerSelect(page)).toHaveCount(0);
		const seriesLink = page.getByRole('link', {
			name: 'Choose the organizer on the series',
		});
		await expect(seriesLink).toHaveAttribute(
			'href',
			new RegExp(`event_date_id=${series.id}$`)
		);
		await seriesLink.click();
		await expect(organizerSelect(page)).toHaveValue(south.id);
	});

	test('chooses the organizer when creating an event in the calendar', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-calendar');
		await page.waitForFunction(() => window.wp?.apiFetch);

		// Cancelling creates nothing.
		await addEventButton(page).click();
		let modal = page.getByRole('dialog', { name: 'Quick Add Event' });
		await expect(organizerSelect(modal)).toHaveValue('default');
		await organizerSelect(modal).selectOption({ label: 'North Club' });
		await modal.getByRole('button', { name: 'Cancel' }).click();
		await expect(modal).toHaveCount(0);

		await addEventButton(page).click();
		modal = page.getByRole('dialog', { name: 'Quick Add Event' });
		await expect(organizerSelect(modal)).toHaveValue('default');
		const title = `Organizer calendar event ${Date.now()}`;
		await modal.getByLabel('Title').fill(title);
		await organizerSelect(modal).selectOption({ label: 'South Club' });
		await modal.getByRole('button', { name: 'Create Event' }).click();
		await expect(
			page
				.locator('#fair-events-calendar-root')
				.getByText(`Event "${title}" created.`)
		).toBeVisible();

		const href = await page
			.getByRole('link', { name: 'Manage Event' })
			.getAttribute('href');
		const createdId = Number(
			new URL(href, 'http://example.test').searchParams.get(
				'event_date_id'
			)
		);
		eventDateIds.push(createdId);
		expect(storedOrganizerId(createdId)).toBe(south.id);

		// Persisted: Manage Event shows it after a fresh load.
		await page.goto(manageUrl(createdId));
		await expect(organizerSelect(page)).toHaveValue(south.id);
	});

	test('copies keep the organizer, also while organizers are off', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');

		const pageCopy = await copyEvent(
			page,
			pageEvent,
			`Organizer page copy ${Date.now()}`
		);
		const copiedPostId = Number(pageCopy.searchParams.get('post'));
		postIds.push(copiedPostId);
		const copiedPageEventId = eventDateIdForPost(copiedPostId);
		eventDateIds.push(copiedPageEventId);
		expect(storedOrganizerId(copiedPageEventId)).toBe(north.id);

		setExperimentalFeature('organizers', false);
		let copiedSeriesId;
		try {
			await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
			const seriesCopy = await copyEvent(
				page,
				series,
				`Organizer series copy ${Date.now()}`
			);
			copiedSeriesId = Number(
				seriesCopy.searchParams.get('event_date_id')
			);
			eventDateIds.push(copiedSeriesId);
			expect(storedOrganizerId(copiedSeriesId)).toBe(south.id);
		} finally {
			setExperimentalFeature('organizers', true);
		}

		const copied = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${copiedSeriesId}/organizer`,
		});
		expect(copied.organizer_id).toBe(south.id);

		const copiedSeries = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${copiedSeriesId}`,
		});
		const occurrences = (copiedSeries.generated_occurrences || []).map(
			(o) => o.id
		);
		eventDateIds.push(...occurrences);
		expect(occurrences.length).toBeGreaterThan(0);
		const fromOccurrence = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${occurrences[0]}/organizer`,
		});
		expect(fromOccurrence.organizer_id).toBe(south.id);
	});

	test('turning organizers off hides the field and keeps the assignment', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		setExperimentalFeature('organizers', false);
		try {
			await page.goto(manageUrl(pageEvent.id));
			await expect(page.getByLabel('Categories')).toBeVisible();
			await expect(organizerSelect(page)).toHaveCount(0);
			expect(storedOrganizerId(pageEvent.id)).toBe(north.id);

			await page.goto('/wp-admin/admin.php?page=fair-events-calendar');
			await addEventButton(page).click();
			const modal = page.getByRole('dialog', {
				name: 'Quick Add Event',
			});
			await expect(modal.getByLabel('Categories')).toBeVisible();
			await expect(organizerSelect(modal)).toHaveCount(0);
		} finally {
			setExperimentalFeature('organizers', true);
		}

		await page.goto(manageUrl(pageEvent.id));
		await expect(organizerSelect(page)).toHaveValue(north.id);
	});
});
