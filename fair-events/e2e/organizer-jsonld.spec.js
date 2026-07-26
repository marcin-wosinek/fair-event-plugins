import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the sitewide Organization JSON-LD block and the event
 * `organizer` reference built from the `fair_events_organizer` setting.
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

async function getJsonLdByType(page, url, type) {
	await page.goto(url);
	const scripts = await page
		.locator('script[type="application/ld+json"]')
		.allTextContents();
	for (const raw of scripts) {
		const data = JSON.parse(raw);
		if (type === data['@type']) {
			return data;
		}
	}
	return null;
}

test.describe('Fair Events sitewide Organization JSON-LD', () => {
	test('emits a configured Organization block and matching event organizer, and falls back once cleared', async ({
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
				fair_events_organizer: {
					name: 'Acme Sports Club',
					type: 'SportsClub',
					street_address: 'Main St 1',
					address_locality: 'Madrid',
					address_country: 'ES',
					same_as: ['https://example.com/acme'],
				},
			},
		});

		const now = new Date();
		const start = new Date(now.getTime() + 24 * 60 * 60 * 1000);
		const iso = (d) => d.toISOString().slice(0, 19).replace('T', ' ');

		const eventDate = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Organizer JSON-LD Test Event',
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

		// Sitewide Organization block, present on any front-end page.
		const org = await getJsonLdByType(page, '/', 'SportsClub');
		expect(org).toBeTruthy();
		expect(org.name).toBe('Acme Sports Club');
		expect(org.address.addressLocality).toBe('Madrid');
		expect(org.sameAs).toEqual(['https://example.com/acme']);
		const organizationId = org['@id'];
		expect(organizationId).toBeTruthy();

		// The event's organizer references the same identity node.
		const event = await getJsonLdByType(page, permalink, 'Event');
		expect(event.organizer['@id']).toBe(organizationId);
		expect(event.organizer.name).toBe('Acme Sports Club');

		// Clear the setting: the event organizer falls back to today's
		// site-name/home-URL behaviour, unchanged.
		await apiFetch(page, {
			path: '/wp/v2/settings',
			method: 'POST',
			data: { fair_events_organizer: {} },
		});

		const clearedEvent = await getJsonLdByType(page, permalink, 'Event');
		expect(clearedEvent.organizer['@id']).toBeUndefined();
		expect(clearedEvent.organizer['@type']).toBe('Organization');

		const clearedOrg = await getJsonLdByType(page, '/', 'Organization');
		expect(clearedOrg).toBeFalsy();

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
