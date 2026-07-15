import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the events-calendar "Subscribe to calendar" link (#1124):
 * a webcal:// link pointing at the public ICS feed, reflecting the block's
 * category filter, plus a copyable plain-URL fallback.
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

test.describe('Events Calendar — Subscribe link', () => {
	test('shows a webcal:// link to the ICS feed and a copyable fallback', async ({
		page,
		context,
	}) => {
		test.setTimeout(60_000);

		await context.grantPermissions(['clipboard-read', 'clipboard-write']);

		await page.setViewportSize({ width: 1200, height: 900 });
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await page.waitForFunction(() => window.wp && window.wp.apiFetch);

		const priorPages = await apiFetch(page, {
			path: '/wp/v2/pages?search=Subscribe%20Calendar&per_page=20',
		});
		for (const p of priorPages) {
			await apiFetch(page, {
				path: `/wp/v2/pages/${p.id}?force=true`,
				method: 'DELETE',
			}).catch(() => {});
		}

		const calendarPage = await apiFetch(page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Subscribe Calendar',
				status: 'publish',
				content: '<!-- wp:fair-events/events-calendar /-->',
			},
		});

		await page.goto(calendarPage.link || `/?page_id=${calendarPage.id}`);

		const link = page.locator('.fair-events-subscribe-link');
		await expect(link).toBeVisible();

		const href = await link.getAttribute('href');
		expect(href).toMatch(/^webcal:\/\//);
		expect(href).toContain('/fair-events/v1/calendar.ics');

		const button = page.locator('.fair-events-subscribe-copy-btn');
		await expect(button).toHaveText('Copy feed URL');

		await button.click();
		await expect(button).toHaveText('✓');

		const clipboardText = await page.evaluate(() =>
			navigator.clipboard.readText()
		);
		expect(clipboardText).toMatch(/^https:\/\//);
		expect(clipboardText).toContain('/fair-events/v1/calendar.ics');

		await expect(button).toHaveText('Copy feed URL', { timeout: 3000 });

		// Cleanup.
		await apiFetch(page, {
			path: `/wp/v2/pages/${calendarPage.id}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
	});

	test('reflects the category filter in the feed URL', async ({ page }) => {
		test.setTimeout(60_000);

		await page.setViewportSize({ width: 1200, height: 900 });
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await page.waitForFunction(() => window.wp && window.wp.apiFetch);

		const categories = await apiFetch(page, {
			path: '/wp/v2/categories?per_page=1&exclude=1',
		});
		test.skip(
			categories.length === 0,
			'No non-default category available for this test'
		);
		const category = categories[0];

		const priorPages = await apiFetch(page, {
			path: '/wp/v2/pages?search=Subscribe%20Calendar%20Filtered&per_page=20',
		});
		for (const p of priorPages) {
			await apiFetch(page, {
				path: `/wp/v2/pages/${p.id}?force=true`,
				method: 'DELETE',
			}).catch(() => {});
		}

		const calendarPage = await apiFetch(page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Subscribe Calendar Filtered',
				status: 'publish',
				content: `<!-- wp:fair-events/events-calendar {"categories":[${category.id}]} /-->`,
			},
		});

		await page.goto(calendarPage.link || `/?page_id=${calendarPage.id}`);

		const link = page.locator('.fair-events-subscribe-link');
		const href = await link.getAttribute('href');
		expect(href).toContain(`categories=${category.slug}`);

		// Cleanup.
		await apiFetch(page, {
			path: `/wp/v2/pages/${calendarPage.id}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
	});
});
