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
 *   --upload <target>   After saving, upload the PNG and print a public URL +
 *                       markdown snippet. Currently supports `imgbb` (needs
 *                       IMGBB_API_KEY in .env). Opt-in: the local file is
 *                       always written; upload is in addition to it. imgbb is
 *                       PUBLIC — synthetic/demo data only.
 *   --expiry <seconds>  Upload TTL for hosts that support it (default 2592000
 *                       = 30 days; 0 keeps it indefinitely). imgbb accepts
 *                       60–15552000.
 *
 * Examples:
 *   node scripts/screenshot.js "/wp-admin/admin.php?page=fair-payments-connector-budgets" mobile budgets-mobile.png
 *   WP_BASE_URL=http://localhost:8889 node scripts/screenshot.js "/" desktop home.png --no-login
 *   node scripts/screenshot.js "/" desktop home.png --no-login --upload imgbb
 */

import { readFile } from 'fs/promises';
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

/** Default upload TTL: 30 days, so stale PR screenshots self-clean. */
const DEFAULT_EXPIRY = 2592000;

/**
 * Upload a PNG buffer to imgbb and return the public link.
 *
 * Mirrors the shape of InstagramPostsController::upload_image() — POST the
 * image to a host, read the public URL back, surface the API error body on
 * failure. imgbb takes the API key (and optional expiration) as query params
 * and the image as a base64 form field. Unlike imgur it still issues free API
 * keys, which is why this replaces the imgur design from #653.
 *
 * @param {Buffer} buffer PNG bytes.
 * @param {number} expiry Seconds until imgbb deletes it (0 = keep forever).
 * @returns {Promise<string>} The public `i.ibb.co` link.
 */
async function uploadToImgbb(buffer, expiry) {
	const apiKey = process.env.IMGBB_API_KEY;
	if (!apiKey) {
		throw new Error(
			'IMGBB_API_KEY is not set. Add it to the repo .env as ' +
				'`IMGBB_API_KEY=<your key>` (get a free key at ' +
				'https://api.imgbb.com/). Never commit the key.'
		);
	}

	const params = new URLSearchParams({ key: apiKey });
	if (expiry > 0) {
		params.set('expiration', String(expiry));
	}

	const form = new FormData();
	form.append('image', buffer.toString('base64'));

	const response = await fetch(`https://api.imgbb.com/1/upload?${params}`, {
		method: 'POST',
		body: form,
	});

	const text = await response.text();
	let data;
	try {
		data = JSON.parse(text);
	} catch {
		data = null;
	}

	if (!response.ok || !data?.data?.url) {
		throw new Error(
			`imgbb upload failed (HTTP ${response.status}).\n${text}`
		);
	}

	return data.data.url;
}

/**
 * Swappable upload targets. A future durable/private host (S3, Cloudinary)
 * slots in here behind `--upload <target>` without touching the CLI. `public`
 * gates the exposure warning.
 */
const UPLOADERS = {
	imgbb: { label: 'imgbb', public: true, upload: uploadToImgbb },
};

/**
 * Read the just-written PNG, hand it to the selected uploader, and print the
 * public URL plus a paste-ready markdown snippet. Throws on an unknown target
 * or upload failure — the caller turns that into a non-zero exit, but the
 * local PNG is already on disk by then.
 */
async function uploadScreenshot(target, outFile, expiry) {
	const uploader = UPLOADERS[target];
	if (!uploader) {
		throw new Error(
			`unknown --upload target "${target}". Supported: ${Object.keys(
				UPLOADERS
			).join(', ')}`
		);
	}

	if (uploader.public) {
		console.error(
			`\n⚠️  Uploading to ${uploader.label}, a PUBLIC host: anyone with the ` +
				'link can view it and GitHub caches it. Upload synthetic/demo data ' +
				'only — admin captures can leak participant names, emails, or finance ' +
				'figures. For real-data pages keep using the pr-assets branch.\n'
		);
	}

	const buffer = await readFile(outFile);
	const link = await uploader.upload(buffer, expiry);
	const alt = path.basename(outFile, path.extname(outFile));

	console.log(`Uploaded: ${link}`);
	console.log(`Markdown:  ![${alt}](${link})`);
}

function parseArgs(argv) {
	const positional = [];
	const opts = {
		fullPage: true,
		wait: 600,
		waitFor: null,
		login: true,
		upload: null,
		expiry: DEFAULT_EXPIRY,
	};

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
			case '--upload':
				opts.upload = argv[++i];
				break;
			case '--expiry':
				opts.expiry = Number(argv[++i]);
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
			'  options: --viewport, --wait <ms>, --wait-for <selector>, --no-login,\n' +
			`           --upload <${Object.keys(UPLOADERS).join(
				' | '
			)}>, --expiry <seconds>`
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

	// Validate the upload target before launching the browser so a typo fails
	// fast instead of after a full capture.
	if (opts.upload && !UPLOADERS[opts.upload]) {
		usage(
			`unknown --upload target "${opts.upload}". Supported: ${Object.keys(
				UPLOADERS
			).join(', ')}`
		);
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

	// Upload last, with the browser already closed and the PNG on disk: an
	// upload failure exits non-zero but never costs the local file.
	if (opts.upload) {
		await uploadScreenshot(opts.upload, outFile, opts.expiry);
	}
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
