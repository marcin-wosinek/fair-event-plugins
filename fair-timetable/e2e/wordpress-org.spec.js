import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Bilingual (en + es_ES) WordPress.org screenshots for fair-timetable.
 *
 * For each locale, creates a demo post, inserts a Timetable block (default
 * template: 3 columns, one time slot each), fills in column/session titles
 * and edits the first time slot to demonstrate the block-editing UX, then
 * publishes and views it on the frontend.
 *
 * Output: assets/screenshot-1.png / screenshot-2.png (English, editor +
 * frontend) and assets/screenshot-1-es_ES.png / screenshot-2-es_ES.png
 * (Spanish), using the WordPress.org localized-asset naming convention.
 *
 * Requires `npm run build` first, so `build/languages/*.json` exists for the
 * `bundled-translations` feature flag this test enables (the es_ES locale is
 * below the translate.wordpress.org publish threshold, so block strings only
 * resolve from the bundled catalog, not a language pack). Locale switching
 * and the feature flag are driven through the `wpcli` docker compose service
 * (`docker compose exec wpcli wp …`, run against the repo-root compose.yml),
 * since neither is reachable through the REST API.
 */

const VIEWPORT = { width: 1200, height: 900 };

const EN_CONTENT = {
	title: 'Conference Schedule Demo',
	blockSearchTerm: 'timetable',
	columns: ['Main Stage', 'Workshop Room', 'Networking Lounge'],
	sessions: ['Opening Keynote', 'Hands-on Workshop', 'Coffee & Connections'],
};

const ES_CONTENT = {
	title: 'Horario de la conferencia',
	// The block title translates to "Horario" under es_ES (see
	// languages/fair-timetable-es_ES.po), so the inserter search needs the
	// translated term too.
	blockSearchTerm: 'horario',
	columns: ['Escenario principal', 'Sala de talleres', 'Zona de networking'],
	sessions: [
		'Conferencia de apertura',
		'Taller práctico',
		'Café y conexiones',
	],
};

/**
 * Run a `wp` command inside the `wpcli` compose service against the
 * repo-root compose.yml (tests run with cwd = fair-timetable/).
 *
 * @param {string[]} args    Arguments passed to `wp`.
 * @param {Object}   options
 * @param {boolean}  options.asRoot Run as root — required for commands that
 *                                  write to wp-content/ (e.g. installing a
 *                                  language pack), since the wpcli image's
 *                                  www-data uid doesn't match the WordPress
 *                                  image's file ownership.
 */
function wpCli(args, { asRoot = false } = {}) {
	const dockerArgs = ['compose', '-f', '../compose.yml', 'exec', '-T'];
	if (asRoot) {
		dockerArgs.push('-u', 'root');
	}
	dockerArgs.push('wpcli', 'wp', ...args);
	if (asRoot) {
		dockerArgs.push('--allow-root');
	}
	execFileSync('docker', dockerArgs, { stdio: 'inherit' });
}

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

/** Delete any leftover demo post from a prior run so re-runs stay deterministic. */
async function deleteExistingDemoPost(page, title) {
	const existing = await apiFetch(page, {
		path: `/wp/v2/posts?search=${encodeURIComponent(
			title
		)}&status=any&per_page=20`,
	});
	for (const p of existing) {
		await apiFetch(page, {
			path: `/wp/v2/posts/${p.id}?force=true`,
			method: 'DELETE',
		}).catch(() => {});
	}
}

/**
 * Build the demo post: title, a Timetable block with three named columns and
 * session titles, and the first time slot edited to 10:15, 1.5h long.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{title: string, columns: string[], sessions: string[]}} content
 */
async function buildDemoPost(page, content) {
	await deleteExistingDemoPost(page, content.title);

	await page.goto('/wp-admin/post-new.php');
	await page.waitForFunction(() => window.wp && window.wp.apiFetch);

	const editorFrame = page.frameLocator('[name="editor-canvas"]');
	await editorFrame.locator('.block-editor-iframe__body').waitFor();
	await page.waitForTimeout(2000);

	// Title. Uses the stable class name rather than the accessible name,
	// which is locale-dependent (e.g. "Escribe un título" under es_ES).
	await editorFrame
		.locator('.editor-post-title__input, .wp-block-post-title')
		.first()
		.fill(content.title);

	// Add Timetable Container block via the main inserter. Selectors use
	// stable class names rather than accessible names/text, which are
	// locale-dependent (button labels and the block title both translate).
	// The block-types-list item carries a stable per-block class
	// (`editor-block-list-item-{name}`) derived from the block name, so it's
	// safe to target directly regardless of locale.
	await page.locator('.editor-document-tools__inserter-toggle').click();
	await page.fill(
		'.block-editor-inserter__search input',
		content.blockSearchTerm
	);
	const timetableInserterItem = page.locator(
		'.editor-block-list-item-fair-timetable-timetable'
	);
	await timetableInserterItem.waitFor();
	await timetableInserterItem.click();

	// Wait for timetable container to be inserted in the iframe.
	await editorFrame.locator('.wp-block-fair-timetable-timetable').waitFor();

	// Close the block inserter popup before editing further.
	await page.keyboard.press('Escape');
	await page.waitForTimeout(500);

	// Fill each column's title.
	const columnHeadings = editorFrame.locator('.time-column-container h2');
	for (let i = 0; i < content.columns.length; i++) {
		await columnHeadings.nth(i).fill(content.columns[i]);
	}

	// Fill each session's title (one time slot per column, in column order).
	const sessionHeadings = editorFrame.locator('.time-slot-container h3');
	for (let i = 0; i < content.sessions.length; i++) {
		await sessionHeadings.nth(i).fill(content.sessions[i]);
	}

	// Edit the first time-slot to start at 10:15, 1.5h long. Click the
	// time-annotation (not the heading inside it) to select the Time Slot
	// block itself rather than its nested Heading block.
	const firstTimeSlot = editorFrame
		.locator('.wp-block-fair-timetable-time-slot')
		.first();
	await firstTimeSlot.locator('.time-annotation').click({ force: true });
	await page.waitForTimeout(1000);

	const startTimeInput = page.locator(
		'input.components-text-control__input[placeholder="09:00"]'
	);
	await startTimeInput.fill('10:15');
	await page.selectOption('select.components-select-control__input', '1.5');
	await page.waitForTimeout(500); // Allow time for re-render.
}

/**
 * Capture the editor screenshot, publish the post, log out, and capture the
 * logged-out frontend screenshot.
 *
 * @param {import('@playwright/test').Page} page
 * @param {string} suffix WordPress.org localized-asset suffix, e.g. '' or '-es_ES'.
 */
async function captureScreenshots(page, suffix) {
	// ---------- 1. Editor screenshot ----------

	await hideAdminChrome(page);
	await page.screenshot({
		path: `assets/screenshot-1${suffix}.png`,
		fullPage: false,
	});

	// Publish. Selectors use stable class names rather than accessible
	// names/text (e.g. "Publish" → "Publicar", "View Post" → "Ver la
	// entrada" under es_ES).
	await page.locator('.editor-post-publish-button__button').click();
	await page.waitForTimeout(1000);
	const finalPublishButton = page.locator(
		'.editor-post-publish-panel__header-publish-button .editor-post-publish-button__button'
	);
	if (await finalPublishButton.isVisible()) {
		await finalPublishButton.click();
	}

	const viewLink = page.locator(
		'.post-publish-panel__postpublish-buttons a.is-primary'
	);
	await expect(viewLink).toBeVisible({ timeout: 15_000 });
	const postUrl = await viewLink.getAttribute('href');

	// ---------- 2. Frontend screenshot (logged out) ----------

	await logout(page);
	await page.goto(postUrl);
	await page.waitForLoadState('networkidle');
	await page.waitForTimeout(800);
	await page.screenshot({
		path: `assets/screenshot-2${suffix}.png`,
		fullPage: false,
	});
}

test.describe('WordPress.org screenshots for Fair Timetable', () => {
	test('Generates bilingual (en + es_ES) editor + frontend screenshots from a demo timetable', async ({
		page,
	}) => {
		test.setTimeout(300_000);

		wpCli(['language', 'core', 'install', 'es_ES'], { asRoot: true });
		wpCli([
			'option',
			'update',
			'fair_timetable_features',
			JSON.stringify({ 'bundled-translations': true }),
			'--format=json',
		]);

		try {
			await page.setViewportSize(VIEWPORT);

			// ---------- English pass ----------
			await login(page);
			await buildDemoPost(page, EN_CONTENT);
			await captureScreenshots(page, '');

			// ---------- Spanish pass ----------
			wpCli(['site', 'switch-language', 'es_ES']);
			await login(page);
			await buildDemoPost(page, ES_CONTENT);
			await captureScreenshots(page, '-es_ES');
		} finally {
			wpCli(['site', 'switch-language', 'en_US']);
		}
	});
});
