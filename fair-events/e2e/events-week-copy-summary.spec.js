import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Verifies the events-week "Copy summary" button, migrated to the
 * Interactivity API (#875): clicking copies the summary to the clipboard,
 * the label flips to the copied state, then reverts after ~2s.
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

test.describe('Events Week — Copy summary (Interactivity API)', () => {
	test('copies the summary and reverts the label after 2s', async ({
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
			path: '/wp/v2/pages?search=Copy%20Summary%20Week&per_page=20',
		});
		for (const p of priorPages) {
			await apiFetch(page, {
				path: `/wp/v2/pages/${p.id}?force=true`,
				method: 'DELETE',
			}).catch(() => {});
		}

		const weekPage = await apiFetch(page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: 'Copy Summary Week',
				status: 'publish',
				content:
					'<!-- wp:fair-events/events-week {"showCopySummary":true} /-->',
			},
		});

		await page.goto(weekPage.link || `/?page_id=${weekPage.id}`);

		const button = page.locator('.fair-events-copy-summary-btn');
		await expect(button).toHaveText('Copy summary');

		await button.click();
		await expect(button).toHaveText('✓');

		const clipboardText = await page.evaluate(() =>
			navigator.clipboard.readText()
		);
		expect(clipboardText).toContain('Copy Summary Week');

		await expect(button).toHaveText('Copy summary', { timeout: 3000 });

		// Cleanup.
		await apiFetch(page, {
			path: `/wp/v2/pages/${weekPage.id}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
	});
});
