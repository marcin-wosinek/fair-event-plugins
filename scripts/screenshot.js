#!/usr/bin/env node

/**
 * Website screenshot helper.
 *
 * Logs into the running WordPress instance and saves a screenshot of any
 * admin (or public) page at a named viewport. Reuses the E2E conventions:
 * the base URL comes from `WP_BASE_URL` and credentials from
 * `WP_ADMIN_USER` / `WP_ADMIN_PASSWORD` (defaults: the wp-env dev instance
 * on :8888, admin / password — same as e2e/smoke.spec.js).
 *
 * Runs headless. The screenshot is written relative to the current working
 * directory, so it lands in whatever folder you invoke the script from.
 *
 * Usage:
 *   node scripts/screenshot.js <path> <dimensions> <filename> [options]
 *   npm run screenshot -- <path> <dimensions> <filename> [options]
 *
 *   <path>        Page to capture, e.g.
 *                 "/wp-admin/admin.php?page=fair-events-manage-event&tab=mailings"
 *   <dimensions>  Preset (desktop | tablet | mobile) or "WIDTHxHEIGHT" (e.g. 414x900)
 *   <filename>    Output file, e.g. mailings-mobile.png (saved in the current dir)
 *
 * Options:
 *   --viewport          Capture only the viewport instead of the full page
 *   --wait <ms>         Extra settle time after load (default 600)
 *   --wait-for <sel>    Wait for a CSS selector before capturing
 *   --no-login          Skip the wp-login step (for public pages)
 *
 * Examples:
 *   node scripts/screenshot.js "/wp-admin/admin.php?page=fair-payment-budgets" mobile budgets-mobile.png
 *   WP_BASE_URL=http://localhost:8889 node scripts/screenshot.js "/" desktop home.png --no-login
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { chromium } from '@playwright/test';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load config (WP_BASE_URL, credentials) from the repo's .env regardless of
// the current working directory, so the helper works when run from anywhere.
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8888';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

/** Named viewport presets. deviceScaleFactor keeps small viewports crisp. */
const PRESETS = {
	desktop: { width: 1280, height: 900, deviceScaleFactor: 1 },
	tablet: { width: 768, height: 1024, deviceScaleFactor: 2 },
	table: { width: 768, height: 1024, deviceScaleFactor: 2 }, // alias
	mobile: { width: 375, height: 812, deviceScaleFactor: 2 },
};

function parseArgs(argv) {
	const positional = [];
	const opts = { fullPage: true, wait: 600, waitFor: null, login: true };

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
			case '--viewport':
				opts.fullPage = false;
				break;
			case '--no-login':
				opts.login = false;
				break;
			case '--wait':
				opts.wait = Number(argv[++i]);
				break;
			case '--wait-for':
				opts.waitFor = argv[++i];
				break;
			default:
				positional.push(arg);
		}
	}

	return { positional, opts };
}

/** Resolve a dimensions argument to a viewport descriptor. */
function resolveViewport(dimensions) {
	const preset = PRESETS[dimensions];
	if (preset) {
		return preset;
	}

	const match = /^(\d+)x(\d+)$/.exec(dimensions);
	if (match) {
		return {
			width: Number(match[1]),
			height: Number(match[2]),
			deviceScaleFactor: 2,
		};
	}

	return null;
}

function usage(message) {
	if (message) {
		console.error(`Error: ${message}\n`);
	}
	console.error(
		'Usage: node scripts/screenshot.js <path> <dimensions> <filename> [options]\n' +
			`  <dimensions>: ${Object.keys(PRESETS).join(
				' | '
			)} | WIDTHxHEIGHT\n` +
			'  options: --viewport, --wait <ms>, --wait-for <selector>, --no-login'
	);
	process.exit(1);
}

async function login(page) {
	await page.goto(`${BASE_URL}/wp-login.php`, { waitUntil: 'load' });

	// Already authenticated — wp-login redirects straight to the dashboard.
	if (!(await page.locator('#user_login').count())) {
		return;
	}

	await page.fill('#user_login', ADMIN_USER);
	await page.fill('#user_pass', ADMIN_PASSWORD);
	await page.click('#wp-submit');
	await page.waitForURL(/\/wp-admin\/?/, { timeout: 30000 });
}

async function main() {
	const { positional, opts } = parseArgs(process.argv.slice(2));
	const [pagePath, dimensions, filename] = positional;

	if (!pagePath || !dimensions || !filename) {
		usage('expected <path> <dimensions> <filename>');
	}

	const viewport = resolveViewport(dimensions);
	if (!viewport) {
		usage(`unknown dimensions "${dimensions}"`);
	}

	const outFile = path.resolve(process.cwd(), filename);
	const url = pagePath.startsWith('http')
		? pagePath
		: `${BASE_URL}${pagePath.startsWith('/') ? '' : '/'}${pagePath}`;

	const browser = await chromium.launch({ headless: true });
	try {
		const context = await browser.newContext({
			viewport: { width: viewport.width, height: viewport.height },
			deviceScaleFactor: viewport.deviceScaleFactor,
		});
		const page = await context.newPage();

		if (opts.login) {
			await login(page);
		}

		await page.goto(url, { waitUntil: 'networkidle' }).catch(async () => {
			// networkidle can stall on long-polling admin pages; fall back.
			await page.goto(url, { waitUntil: 'load' });
		});

		if (opts.waitFor) {
			await page.waitForSelector(opts.waitFor, { timeout: 30000 });
		}
		if (opts.wait) {
			await page.waitForTimeout(opts.wait);
		}

		await page.screenshot({ path: outFile, fullPage: opts.fullPage });
		console.log(
			`Saved ${dimensions} (${viewport.width}x${viewport.height}) screenshot of ${url}\n  → ${outFile}`
		);
	} finally {
		await browser.close();
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
