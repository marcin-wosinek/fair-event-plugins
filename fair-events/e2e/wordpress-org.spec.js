import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * WordPress.org screenshots for fair-events.
 *
 * Seeds a handful of event-dates spread across the current month so the
 * Calendar / All Events / Manage Event admin pages, and the frontend blocks,
 * all have real-looking data to render.
 *
 * Output: assets/screenshot-1.png … screenshot-6.png (1200x900).
 */

const VIEWPORT = { width: 1200, height: 900 };

/**
 * Run @wordpress/api-fetch from inside an admin page so the request is
 * authenticated and nonce'd automatically.
 */
async function apiFetch(page, options) {
	const result = await page.evaluate(async (opts) => {
		try {
			// eslint-disable-next-line no-undef
			const res = await wp.apiFetch(opts);
			return { ok: true, data: res };
		} catch (err) {
			return {
				ok: false,
				error: {
					message: err && err.message,
					code: err && err.code,
					data: err && err.data,
					raw: JSON.stringify(err),
				},
			};
		}
	}, options);
	if (!result.ok) {
		throw new Error(
			`apiFetch ${options.method || 'GET'} ${
				options.path
			} failed: ${JSON.stringify(result.error)}`
		);
	}
	return result.data;
}

function pad(n) {
	return String(n).padStart(2, '0');
}

function buildSeedDates() {
	const now = new Date();
	const year = now.getFullYear();
	const month = now.getMonth(); // 0-indexed
	const monthStr = `${year}-${pad(month + 1)}`;

	// Spread events across the current month so the calendar grid looks alive.
	return [
		{
			title: 'Yoga Workshop',
			day: 5,
			start_time: '10:00',
			end_time: '12:00',
			address: 'Park Pavilion, 123 Sunrise Ave',
		},
		{
			title: 'Community Potluck',
			day: 11,
			start_time: '18:30',
			end_time: '21:00',
			address: 'Community Hall, 45 Maple Street',
		},
		{
			title: 'Open Mic Night',
			day: 18,
			start_time: '20:00',
			end_time: '23:00',
			address: 'The Corner Cafe, 7 Willow Lane',
		},
		{
			title: 'Sunday Hike',
			day: 22,
			start_time: '09:00',
			end_time: '13:00',
			address: 'Trailhead Parking, North Ridge Park',
		},
		{
			title: 'Pottery Class',
			day: 26,
			start_time: '14:00',
			end_time: '16:30',
			address: 'Craft Studio, 88 Oak Boulevard',
		},
	].map((e) => {
		const lastDay = new Date(year, month + 1, 0).getDate();
		const day = Math.min(e.day, lastDay);
		const dateStr = `${monthStr}-${pad(day)}`;
		return {
			...e,
			day,
			start_datetime: `${dateStr} ${e.start_time}:00`,
			end_datetime: `${dateStr} ${e.end_time}:00`,
		};
	});
}

async function login(page) {
	await page.goto('/wp-admin');
	if (page.url().includes('wp-login.php')) {
		await page.fill('#user_login', WP_ADMIN_USER);
		await page.fill('#user_pass', WP_ADMIN_PASS);
		await page.click('#wp-submit');
	}
	await page.waitForSelector('#wpadminbar');
}

async function logout(page) {
	const cookies = await page.context().cookies();
	await page.context().clearCookies();
	// Bust any cached session state.
	return cookies;
}

test.describe('WordPress.org screenshots for Fair Events', () => {
	test('Generates admin + block screenshots from seeded data', async ({
		page,
		context,
	}) => {
		test.setTimeout(180_000);

		await page.setViewportSize(VIEWPORT);
		await login(page);

		// Land on an admin page that loads window.wp.apiFetch.
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await page.waitForFunction(() => window.wp && window.wp.apiFetch);

		// Make sure the fair_event post type is enabled so we can promote a
		// seed to a real post and so the calendar-button variation is active
		// on the frontend.
		await apiFetch(page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_events_register_post_type: true,
				fair_events_enabled_post_types: ['fair_event'],
			},
		});

		// Clean prior seed data so re-runs stay deterministic.
		const existing = await apiFetch(page, {
			path: '/fair-events/v1/event-dates?include_linked=true&per_page=200',
		});
		for (const ed of existing) {
			await apiFetch(page, {
				path: `/fair-events/v1/event-dates/${ed.id}`,
				method: 'DELETE',
			}).catch(() => {});
			if (ed.event_id) {
				await apiFetch(page, {
					path: `/wp/v2/fair_event/${ed.event_id}?force=true`,
					method: 'DELETE',
				}).catch(() => {});
			}
		}

		// Drop any prior "Upcoming Events" pages from earlier runs.
		const priorPages = await apiFetch(page, {
			path: '/wp/v2/pages?search=Upcoming%20Events&per_page=20',
		});
		for (const p of priorPages) {
			if (p.title?.rendered === 'Upcoming Events') {
				await apiFetch(page, {
					path: `/wp/v2/pages/${p.id}?force=true`,
					method: 'DELETE',
				}).catch(() => {});
			}
		}

		// Seed event dates (each with an address so the Event Info block
		// has venue text to render).
		const seeds = buildSeedDates();
		const created = [];
		for (const seed of seeds) {
			const resp = await apiFetch(page, {
				path: '/fair-events/v1/event-dates',
				method: 'POST',
				data: {
					title: seed.title,
					start_datetime: seed.start_datetime,
					end_datetime: seed.end_datetime,
					all_day: false,
				},
			});
			// The create endpoint doesn't accept address inline; patch it in.
			if (seed.address) {
				await apiFetch(page, {
					path: `/fair-events/v1/event-dates/${resp.id}`,
					method: 'PUT',
					data: { address: seed.address },
				}).catch(() => {});
			}
			created.push({ ...seed, id: resp.id });
		}

		// Promote the headline seed to a real WP post for the Event Info shot.
		const headlineSeed = created[0];
		const headlinePost = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${headlineSeed.id}/create-post`,
			method: 'POST',
			data: { post_status: 'publish' },
		});
		const headlinePostId = headlinePost.event_id || headlinePost.post_id;

		// Promote a second seed to host the Add to Calendar shot.
		const buttonSeed = created[1];
		const buttonPost = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${buttonSeed.id}/create-post`,
			method: 'POST',
			data: { post_status: 'publish' },
		});
		const buttonPostId = buttonPost.event_id || buttonPost.post_id;

		// Headline post — Event Info block only.
		await apiFetch(page, {
			path: `/wp/v2/fair_event/${headlinePostId}`,
			method: 'POST',
			data: {
				content: '<!-- wp:fair-events/event-info /-->',
				status: 'publish',
			},
		});

		// Button post — Add to Calendar block only (plus a brief heading so
		// the page isn't just a floating button).
		const buttonPostContent = [
			'<!-- wp:heading -->',
			`<h2 class="wp-block-heading">${buttonSeed.title}</h2>`,
			'<!-- /wp:heading -->',
			'',
			'<!-- wp:paragraph -->',
			'<p>Save the date — add this event to your calendar in one click.</p>',
			'<!-- /wp:paragraph -->',
			'',
			'<!-- wp:buttons -->',
			'<div class="wp-block-buttons"><!-- wp:button {"isCalendarButton":true} -->',
			'<div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Add to Calendar</a></div>',
			'<!-- /wp:button --></div>',
			'<!-- /wp:buttons -->',
		].join('\n');
		await apiFetch(page, {
			path: `/wp/v2/fair_event/${buttonPostId}`,
			method: 'POST',
			data: { content: buttonPostContent, status: 'publish' },
		});

		// Create a public page hosting the Events Calendar block.
		const calendarPage = await apiFetch(page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Upcoming Events',
				status: 'publish',
				content: '<!-- wp:fair-events/events-calendar /-->',
			},
		});

		// Hide noisy admin chrome (core-update banner, WP-CLI debug notices)
		// for every admin screenshot.
		async function hideAdminChrome() {
			await page.addStyleTag({
				content: `
					.update-nag,
					.notice,
					.update-message,
					#wp-admin-bar-updates,
					div.error,
					div.updated { display: none !important; }
				`,
			});
		}

		// ---------- Admin screenshots ----------

		// 1. Calendar admin page.
		const now = new Date();
		const monthSlug = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-calendar&month=${monthSlug}`
		);
		// Wait for the calendar grid to render with our seeded events.
		await page.waitForLoadState('networkidle');
		await expect(page.getByText(headlineSeed.title).first()).toBeVisible({
			timeout: 15_000,
		});
		await hideAdminChrome();
		await page.waitForTimeout(800);
		await page.screenshot({
			path: 'assets/screenshot-1.png',
			fullPage: false,
		});

		// 2. All Events admin page.
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await page.waitForLoadState('networkidle');
		await expect(page.getByText(headlineSeed.title).first()).toBeVisible({
			timeout: 15_000,
		});
		await hideAdminChrome();
		await page.waitForTimeout(800);
		await page.screenshot({
			path: 'assets/screenshot-2.png',
			fullPage: false,
		});

		// 3. Manage Event admin page.
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${headlineSeed.id}`
		);
		await page.waitForLoadState('networkidle');
		// Wait for the React title input to populate. The value lives on
		// the DOM property, not the HTML attribute, so check it via JS.
		await page.waitForFunction(
			(expected) => {
				const root = document.querySelector(
					'#fair-events-manage-event-root'
				);
				if (!root) return false;
				const inputs = root.querySelectorAll('input');
				for (const i of inputs) {
					if (i.value === expected) return true;
				}
				return false;
			},
			headlineSeed.title,
			{ timeout: 20_000 }
		);
		await hideAdminChrome();
		await page.waitForTimeout(1200);
		await page.screenshot({
			path: 'assets/screenshot-3.png',
			fullPage: false,
		});

		// ---------- Frontend screenshots (logged out) ----------

		const eventInfoLink = `/?p=${headlinePostId}`;
		const buttonPostLink = `/?p=${buttonPostId}`;
		const calendarPageLink =
			calendarPage.link || `/?page_id=${calendarPage.id}`;

		await logout(page);

		// 4. Events Calendar block on a public page.
		await page.goto(calendarPageLink);
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(800);
		await page.screenshot({
			path: 'assets/screenshot-4.png',
			fullPage: false,
		});

		// 5. Event Info block on a single event post.
		await page.goto(eventInfoLink);
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(800);
		await page.screenshot({
			path: 'assets/screenshot-5.png',
			fullPage: false,
		});

		// 6. Add to Calendar block on its own post.
		await page.goto(buttonPostLink);
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(800);
		await page.screenshot({
			path: 'assets/screenshot-6.png',
			fullPage: false,
		});
	});
});
