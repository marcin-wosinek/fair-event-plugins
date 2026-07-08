import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * WordPress.org screenshots for fair-timetable.
 *
 * Creates a demo post, inserts a Timetable block (default template: 3
 * columns, one time slot each), edits the first time slot to demonstrate the
 * block-editing UX, then publishes and views it on the frontend.
 *
 * Output: assets/screenshot-1.png (editor), screenshot-2.png (frontend).
 */

const VIEWPORT = { width: 1200, height: 900 };
const DEMO_TITLE = 'Conference Schedule Demo';

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

async function login(page) {
	await page.goto('/wp-admin');
	if (page.url().includes('wp-login.php')) {
		await page.fill('#user_login', WP_ADMIN_USER);
		await page.fill('#user_pass', WP_ADMIN_PASS);
		await page.click('#wp-submit');
	}
	await page.waitForSelector('#wpadminbar');
}

function logout(page) {
	return page.context().clearCookies();
}

/** Hide noisy admin chrome (core-update banner, WP-CLI debug notices). */
async function hideAdminChrome(page) {
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

test.describe('WordPress.org screenshots for Fair Timetable', () => {
	test('Generates editor + frontend screenshots from a demo timetable', async ({
		page,
	}) => {
		test.setTimeout(180_000);

		await page.setViewportSize(VIEWPORT);
		await login(page);

		// Land on an admin page that loads window.wp.apiFetch.
		await page.goto('/wp-admin/post-new.php');
		await page.waitForFunction(() => window.wp && window.wp.apiFetch);

		// Clean up any demo post from a prior run so re-runs stay deterministic.
		const existing = await apiFetch(page, {
			path: `/wp/v2/posts?search=${encodeURIComponent(
				DEMO_TITLE
			)}&status=any&per_page=20`,
		});
		for (const p of existing) {
			await apiFetch(page, {
				path: `/wp/v2/posts/${p.id}?force=true`,
				method: 'DELETE',
			}).catch(() => {});
		}

		// ---------- Build the demo post ----------

		const editorFrame = page.frameLocator('[name="editor-canvas"]');
		await editorFrame.locator('.block-editor-iframe__body').waitFor();
		await page.waitForTimeout(2000);

		// Title.
		await editorFrame
			.getByRole('textbox', { name: 'Add title' })
			.fill(DEMO_TITLE);

		// Add Timetable Container block via the main inserter.
		await page.getByRole('button', { name: 'Block Inserter' }).click();
		await page.fill('.block-editor-inserter__search input', 'timetable');
		await page.click(
			'.block-editor-block-types-list__item:has-text("Timetable")'
		);

		// Wait for timetable container to be inserted in the iframe.
		await editorFrame
			.locator('.wp-block-fair-timetable-timetable')
			.waitFor();

		// Close the block inserter popup before editing time-slots.
		const closeInserterButton = page.getByRole('button', {
			name: 'Close Block Inserter',
		});
		if (await closeInserterButton.isVisible()) {
			await closeInserterButton.click();
			await page.waitForTimeout(500);
		}

		// Edit the first time-slot to start at 10:15, 1.5h long.
		const firstTimeSlot = editorFrame
			.locator('.wp-block-fair-timetable-time-slot')
			.first();
		await firstTimeSlot.waitFor();
		await firstTimeSlot.click();
		await page.waitForTimeout(1000);

		const startTimeInput = page.locator(
			'input.components-text-control__input[placeholder="09:00"]'
		);
		await startTimeInput.fill('10:15');
		await page.selectOption(
			'select.components-select-control__input',
			'1.5'
		);
		await page.waitForTimeout(500); // Allow time for re-render.

		// ---------- 1. Editor screenshot ----------

		await hideAdminChrome(page);
		await page.screenshot({
			path: 'assets/screenshot-1.png',
			fullPage: false,
		});

		// Publish.
		await page
			.getByRole('button', { name: 'Publish', exact: true })
			.click();
		await page.waitForTimeout(1000);
		const finalPublishButton = page
			.getByLabel('Editor publish')
			.getByRole('button', { name: 'Publish', exact: true });
		if (await finalPublishButton.isVisible()) {
			await finalPublishButton.click();
		}

		const viewLink = page
			.getByLabel('Editor publish')
			.getByRole('link', { name: 'View Post' });
		await expect(viewLink).toBeVisible({ timeout: 15_000 });
		const postUrl = await viewLink.getAttribute('href');

		// ---------- 2. Frontend screenshot (logged out) ----------

		await logout(page);
		await page.goto(postUrl);
		await page.waitForLoadState('networkidle');
		await page.waitForTimeout(800);
		await page.screenshot({
			path: 'assets/screenshot-2.png',
			fullPage: false,
		});
	});
});
