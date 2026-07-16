import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the events-calendar "Subscribe to calendar" dropdown (#1154):
 * a single outline trigger button that opens a dropdown with Google
 * Calendar, Outlook, Apple Calendar (webcal), and Copy feed URL entries,
 * all reflecting the block's category filter.
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

async function createCalendarPage(page, title, content) {
	const priorPages = await apiFetch(page, {
		path: `/wp/v2/pages?search=${encodeURIComponent(title)}&per_page=20`,
	});
	for (const p of priorPages) {
		await apiFetch(page, {
			path: `/wp/v2/pages/${p.id}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
	}

	return apiFetch(page, {
		path: '/wp/v2/pages',
		method: 'POST',
		data: { title, status: 'publish', content },
	});
}

test.describe('Events Calendar — Subscribe dropdown', () => {
	test('shows a single trigger that opens a dropdown with all subscription options', async ({
		page,
		context,
	}) => {
		test.setTimeout(60_000);

		await context.grantPermissions(['clipboard-read', 'clipboard-write']);

		await page.setViewportSize({ width: 1200, height: 900 });
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await page.waitForFunction(() => window.wp && window.wp.apiFetch);

		const calendarPage = await createCalendarPage(
			page,
			'Subscribe Calendar',
			'<!-- wp:fair-events/events-calendar /-->'
		);

		await page.goto(calendarPage.link || `/?page_id=${calendarPage.id}`);

		const trigger = page.locator('.fair-events-subscribe-trigger');
		await expect(trigger).toBeVisible();
		await expect(trigger).toHaveText('Subscribe to calendar');
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');

		// No leftover elements from the old three-element stack: the old
		// always-visible link is gone, and the note is only inside the
		// (closed) dropdown panel, not visible on the page.
		await expect(page.locator('.fair-events-subscribe-link')).toHaveCount(
			0
		);

		const panel = page.locator('.fair-events-subscribe-panel');
		await expect(panel).toBeHidden();
		await expect(panel.locator('.fair-events-subscribe-note')).toBeHidden();

		await trigger.click();
		await expect(trigger).toHaveAttribute('aria-expanded', 'true');
		await expect(panel).toBeVisible();

		const entries = panel.locator('.fair-events-subscribe-entry');
		await expect(entries).toHaveCount(4);

		const googleEntry = panel.getByRole('menuitem', {
			name: 'Google Calendar',
		});
		await expect(googleEntry).toHaveAttribute('target', '_blank');
		const googleHref = await googleEntry.getAttribute('href');
		expect(googleHref).toContain('calendar.google.com/calendar/r?cid=');
		expect(decodeURIComponent(googleHref)).toContain(
			'/fair-events/v1/calendar.ics'
		);

		const outlookEntry = panel.getByRole('menuitem', { name: 'Outlook' });
		await expect(outlookEntry).toHaveAttribute('target', '_blank');
		const outlookHref = await outlookEntry.getAttribute('href');
		expect(outlookHref).toContain('outlook.live.com/calendar/0/addfromweb');
		expect(decodeURIComponent(outlookHref)).toContain(
			'/fair-events/v1/calendar.ics'
		);

		const appleEntry = panel.getByRole('menuitem', {
			name: 'Apple Calendar',
		});
		const appleHref = await appleEntry.getAttribute('href');
		expect(appleHref).toMatch(/^webcal:\/\//);
		expect(appleHref).toContain('/fair-events/v1/calendar.ics');

		await expect(panel.locator('.fair-events-subscribe-note')).toHaveText(
			"Subscribed calendars refresh on your calendar app's own schedule (often hours, not instant)."
		);

		// Copy entry copies the feed URL and shows the confirmation.
		const copyButton = panel.locator('.fair-events-subscribe-entry-copy');
		await copyButton.click();
		await expect(copyButton).toHaveText('✓');

		const clipboardText = await page.evaluate(() =>
			navigator.clipboard.readText()
		);
		expect(clipboardText).toMatch(/^https?:\/\//);
		expect(clipboardText).toContain('/fair-events/v1/calendar.ics');

		await expect(copyButton).toHaveText('Copy feed URL', {
			timeout: 3000,
		});

		// Escape closes the dropdown.
		await page.keyboard.press('Escape');
		await expect(panel).toBeHidden();
		await expect(trigger).toHaveAttribute('aria-expanded', 'false');

		// Outside click closes the dropdown (click the calendar navigation
		// title — on-page but outside the admin bar and the dropdown).
		await trigger.click();
		await expect(panel).toBeVisible();
		await page.locator('.navigation-title').click();
		await expect(panel).toBeHidden();

		// Selecting the Apple Calendar entry closes the dropdown.
		await trigger.click();
		await expect(panel).toBeVisible();
		await appleEntry.click();
		await expect(panel).toBeHidden();

		// Cleanup.
		await apiFetch(page, {
			path: `/wp/v2/pages/${calendarPage.id}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
	});

	test('reflects the category filter in the feed URLs', async ({ page }) => {
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

		const calendarPage = await createCalendarPage(
			page,
			'Subscribe Calendar Filtered',
			`<!-- wp:fair-events/events-calendar {"categories":[${category.id}]} /-->`
		);

		await page.goto(calendarPage.link || `/?page_id=${calendarPage.id}`);

		await page.locator('.fair-events-subscribe-trigger').click();
		const panel = page.locator('.fair-events-subscribe-panel');

		const googleHref = await panel
			.getByRole('menuitem', { name: 'Google Calendar' })
			.getAttribute('href');
		expect(decodeURIComponent(googleHref)).toContain(
			`categories=${category.slug}`
		);

		const appleHref = await panel
			.getByRole('menuitem', { name: 'Apple Calendar' })
			.getAttribute('href');
		expect(appleHref).toContain(`categories=${category.slug}`);

		// Cleanup.
		await apiFetch(page, {
			path: `/wp/v2/pages/${calendarPage.id}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
	});
});
