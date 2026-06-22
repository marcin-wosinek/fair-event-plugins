/**
 * Shared WP-CLI + admin plumbing for the E2E specs.
 *
 * Centralizes the helpers that used to be copy-pasted into individual specs so
 * the seed/state eval-file scripts and the admin login are driven the same way
 * everywhere.
 */

import { execSync } from 'node:child_process';

/** wp-env defaults; overridable per the API-test convention. */
export const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
export const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

/**
 * Run a WP-CLI command against the wp-env `tests` instance and return stdout.
 *
 * @param {string}  args                   WP-CLI arguments (everything after `wp`).
 * @param {object}  [options]
 * @param {boolean} [options.allowFailure]  Return stdout instead of throwing on
 *                                          a non-zero exit code.
 * @return {string} Command stdout.
 */
export function wpCli(args, { allowFailure = false } = {}) {
	try {
		return execSync(`npx wp-env run tests-cli wp ${args}`, {
			cwd: process.cwd(),
			encoding: 'utf8',
			stdio: ['ignore', 'pipe', 'pipe'],
		});
	} catch (err) {
		if (allowFailure) {
			return `${err.stdout || ''}`;
		}
		throw err;
	}
}

/**
 * Run a seed/state/cleanup eval-file script and parse its `MARKER:{json}` output.
 *
 * @param {string} file      Script filename under mu-plugins/scripts/.
 * @param {string} marker    Output marker (e.g. 'E2E_SEED').
 * @param {string} extraArgs Positional args passed to the script.
 * @return {object} Parsed JSON payload.
 */
export function runScript(file, marker, extraArgs = '') {
	const out = wpCli(
		`eval-file wp-content/mu-plugins/scripts/${file} ${extraArgs}`.trim()
	);
	const match = out.match(new RegExp(`${marker}:(\\{.*\\})`));
	if (!match) {
		throw new Error(`Expected ${marker} in WP-CLI output, got:\n${out}`);
	}
	return JSON.parse(match[1]);
}

/** Clear captured mail so each scenario starts clean. */
export function resetCapturedMail() {
	try {
		wpCli('option delete fair_e2e_captured_mail');
	} catch {
		// Option may not exist yet — nothing to clear.
	}
}

/**
 * Log into wp-admin as the configured admin and wait for the dashboard.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 */
export async function loginAsAdmin(page) {
	await page.goto('/wp-login.php');
	await page.fill('#user_login', ADMIN_USER);
	await page.fill('#user_pass', ADMIN_PASSWORD);
	await page.click('#wp-submit');
	await page.waitForURL(/\/wp-admin\/?/);
}
