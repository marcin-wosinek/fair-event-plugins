import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the Schema.org `ItemList` JSON-LD emitted by the calendar/week
 * blocks: it parses, carries sequential positions/URLs for every seeded
 * event, and lists a multi-day event exactly once (the list is built from
 * the flat, deduplicated occurrence list, not the per-day grid).
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

async function login(page) {
	await page.goto('/wp-admin');
	if (page.url().includes('wp-login.php')) {
		await page.fill('#user_login', WP_ADMIN_USER);
		await page.fill('#user_pass', WP_ADMIN_PASS);
		await page.click('#wp-submit');
	}
	await page.waitForSelector('#wpadminbar');
}

async function getItemListJsonLd(page, url) {
	await page.goto(url);
	const scripts = await page
		.locator('script[type="application/ld+json"]')
		.allTextContents();
	for (const raw of scripts) {
		const data = JSON.parse(raw);
		if ('ItemList' === data['@type']) {
			return data;
		}
	}
	return null;
}

test.describe('Fair Events calendar/week block ItemList JSON-LD', () => {
	test('emits one ItemList entry per event, with a multi-day event listed once', async ({
		page,
	}) => {
		test.setTimeout(120_000);

		await page.setViewportSize({ width: 1200, height: 900 });
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await page.waitForFunction(() => window.wp && window.wp.apiFetch);

		await apiFetch(page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: {
				fair_events_register_post_type: true,
				fair_events_enabled_post_types: ['fair_event'],
			},
		});

		// Clean prior seed data so re-runs stay deterministic and position
		// assertions aren't thrown off by leftovers from other specs.
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

		const priorPages = await apiFetch(page, {
			path: '/wp/v2/pages?search=ItemList%20JSON-LD&per_page=20',
		});
		for (const p of priorPages) {
			await apiFetch(page, {
				path: `/wp/v2/pages/${p.id}?force=true`,
				method: 'DELETE',
			}).catch(() => {});
		}

		const now = new Date();
		const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

		// A same-day standalone event, a few hours from now.
		const singleDay = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'ItemList JSON-LD Single Day Event',
				start_datetime: iso(
					new Date(now.getTime() + 2 * 60 * 60 * 1000)
				),
				end_datetime: iso(new Date(now.getTime() + 3 * 60 * 60 * 1000)),
				all_day: false,
			},
		});

		// A multi-day event spanning today and tomorrow — must appear exactly
		// once in the ItemList, not once per day it's rendered on the grid.
		const multiDay = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'ItemList JSON-LD Multi Day Event',
				start_datetime: iso(
					new Date(now.getTime() + 4 * 60 * 60 * 1000)
				),
				end_datetime: iso(
					new Date(now.getTime() + 28 * 60 * 60 * 1000)
				),
				all_day: false,
			},
		});

		const calendarPage = await apiFetch(page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'ItemList JSON-LD Calendar',
				status: 'publish',
				content: '<!-- wp:fair-events/events-calendar /-->',
			},
		});

		const weekPage = await apiFetch(page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'ItemList JSON-LD Week',
				status: 'publish',
				content: '<!-- wp:fair-events/events-week /-->',
			},
		});

		const pageUrls = [
			calendarPage.link || `/?page_id=${calendarPage.id}`,
			weekPage.link || `/?page_id=${weekPage.id}`,
		];

		for (const pageUrl of pageUrls) {
			const itemList = await getItemListJsonLd(page, pageUrl);

			expect(itemList).toBeTruthy();
			expect(itemList['@context']).toBe('https://schema.org');
			expect(itemList.itemListElement).toHaveLength(2);

			const positions = itemList.itemListElement.map((li) => li.position);
			expect(positions).toEqual([1, 2]);

			const names = itemList.itemListElement.map((li) => li.item.name);
			expect(names).toContain('ItemList JSON-LD Single Day Event');
			expect(names).toContain('ItemList JSON-LD Multi Day Event');

			for (const li of itemList.itemListElement) {
				expect(li.item['@type']).toBe('Event');
				expect(li.item.startDate).toBeTruthy();
			}
		}

		// Cleanup.
		for (const ed of [singleDay, multiDay]) {
			await apiFetch(page, {
				path: `/fair-events/v1/event-dates/${ed.id}`,
				method: 'DELETE',
			}).catch(() => {});
		}
		await apiFetch(page, {
			path: `/wp/v2/pages/${calendarPage.id}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
		await apiFetch(page, {
			path: `/wp/v2/pages/${weekPage.id}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
	});
});
