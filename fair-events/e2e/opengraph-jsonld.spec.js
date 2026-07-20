import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the Schema.org Event JSON-LD emitted on wp_head for singular
 * event posts: a `location` node is always present, and `offers` reflects
 * ticket types + active sale-period prices when present.
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

async function getJsonLd(page, url) {
	await page.goto(url);
	const raw = await page
		.locator('script[type="application/ld+json"]')
		.first()
		.textContent();
	return JSON.parse(raw);
}

async function getMetaContent(page, url, property) {
	await page.goto(url);
	return page.locator(`meta[property="${property}"]`).getAttribute('content');
}

test.describe('Fair Events JSON-LD structured data', () => {
	test('emits location and offers for an event with a venue and ticket types', async ({
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

		const now = new Date();
		const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
		const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

		const eventDate = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'JSON-LD Test Event With Tickets',
				start_datetime: iso(start),
				end_datetime: iso(
					new Date(start.getTime() + 2 * 60 * 60 * 1000)
				),
				all_day: false,
			},
		});
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}`,
			method: 'PUT',
			data: { address: '123 Test Street, Testville' },
		});

		const post = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}/create-post`,
			method: 'POST',
			data: { post_status: 'publish' },
		});
		const postId = post.event_id || post.post_id;

		// Active sale period covering "now" plus a public ticket type priced in it.
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [{ name: 'General Admission' }],
				sale_periods: [
					{
						name: 'Main sale',
						sale_start: iso(
							new Date(now.getTime() - 24 * 60 * 60 * 1000)
						),
						sale_end: iso(
							new Date(now.getTime() + 24 * 60 * 60 * 1000)
						),
					},
				],
				prices: [
					{
						ticket_type_index: 0,
						sale_period_index: 0,
						price: 15,
					},
				],
			},
		});

		const permalink = post.link || `/?p=${postId}`;
		const data = await getJsonLd(page, permalink);

		expect(data['@type']).toBe('Event');
		expect(data.location).toBeTruthy();
		expect(data.location.address.name).toBe('123 Test Street, Testville');
		expect(data.eventAttendanceMode).toBe(
			'https://schema.org/OfflineEventAttendanceMode'
		);
		expect(data.offers).toHaveLength(1);
		expect(data.offers[0].price).toBe('15');
		expect(data.offers[0].priceCurrency).toBeTruthy();
		expect(data.isAccessibleForFree).toBeUndefined();

		// Cleanup.
		await apiFetch(page, {
			path: `/wp/v2/fair_event/${postId}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}`,
			method: 'DELETE',
		}).catch(() => {});
	});

	test('still emits a valid location with no offers for an event without ticket types', async ({
		page,
	}) => {
		test.setTimeout(120_000);

		await page.setViewportSize({ width: 1200, height: 900 });
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await page.waitForFunction(() => window.wp && window.wp.apiFetch);

		const now = new Date();
		const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
		const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

		const eventDate = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'JSON-LD Test Event Without Tickets',
				start_datetime: iso(start),
				end_datetime: iso(
					new Date(start.getTime() + 2 * 60 * 60 * 1000)
				),
				all_day: false,
			},
		});

		const post = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}/create-post`,
			method: 'POST',
			data: { post_status: 'publish' },
		});
		const postId = post.event_id || post.post_id;

		const permalink = post.link || `/?p=${postId}`;
		const data = await getJsonLd(page, permalink);

		expect(data['@type']).toBe('Event');
		expect(data.location).toBeTruthy();
		expect(data.location['@type']).toBe('Place');
		expect(data.offers).toBeUndefined();
		expect(data.isAccessibleForFree).toBeUndefined();

		// Cleanup.
		await apiFetch(page, {
			path: `/wp/v2/fair_event/${postId}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}`,
			method: 'DELETE',
		}).catch(() => {});
	});

	test('emits isAccessibleForFree for an event with only a zero-price ticket type', async ({
		page,
	}) => {
		test.setTimeout(120_000);

		await page.setViewportSize({ width: 1200, height: 900 });
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await page.waitForFunction(() => window.wp && window.wp.apiFetch);

		const now = new Date();
		const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
		const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

		const eventDate = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'JSON-LD Test Free Event',
				start_datetime: iso(start),
				end_datetime: iso(
					new Date(start.getTime() + 2 * 60 * 60 * 1000)
				),
				all_day: false,
			},
		});

		const post = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}/create-post`,
			method: 'POST',
			data: { post_status: 'publish' },
		});
		const postId = post.event_id || post.post_id;

		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [{ name: 'Free Admission' }],
				sale_periods: [
					{
						name: 'Main sale',
						sale_start: iso(
							new Date(now.getTime() - 24 * 60 * 60 * 1000)
						),
						sale_end: iso(
							new Date(now.getTime() + 24 * 60 * 60 * 1000)
						),
					},
				],
				prices: [
					{
						ticket_type_index: 0,
						sale_period_index: 0,
						price: 0,
					},
				],
			},
		});

		const permalink = post.link || `/?p=${postId}`;
		const data = await getJsonLd(page, permalink);

		expect(data.offers).toHaveLength(1);
		expect(data.offers[0].price).toBe('0');
		expect(data.isAccessibleForFree).toBe(true);

		// Cleanup.
		await apiFetch(page, {
			path: `/wp/v2/fair_event/${postId}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}`,
			method: 'DELETE',
		}).catch(() => {});
	});

	test('emits og:type "event" for an event page', async ({ page }) => {
		test.setTimeout(120_000);

		await page.setViewportSize({ width: 1200, height: 900 });
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await page.waitForFunction(() => window.wp && window.wp.apiFetch);

		const now = new Date();
		const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
		const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

		const eventDate = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'OG Type Test Event',
				start_datetime: iso(start),
				end_datetime: iso(
					new Date(start.getTime() + 2 * 60 * 60 * 1000)
				),
				all_day: false,
			},
		});

		const post = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}/create-post`,
			method: 'POST',
			data: { post_status: 'publish' },
		});
		const postId = post.event_id || post.post_id;

		const permalink = post.link || `/?p=${postId}`;
		const ogType = await getMetaContent(page, permalink, 'og:type');

		expect(ogType).toBe('event');

		// Cleanup.
		await apiFetch(page, {
			path: `/wp/v2/fair_event/${postId}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}`,
			method: 'DELETE',
		}).catch(() => {});
	});
});
