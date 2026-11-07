/**
 * Shared WP-CLI + admin plumbing for the E2E specs.
 *
 * Centralizes the helpers that used to be copy-pasted into individual specs so
 * the seed/state eval-file scripts and the admin login are driven the same way
 * everywhere.
 */

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

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
			cwd: fileURLToPath(new URL('../../', import.meta.url)),
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
 * Whether ticket payments send the buyer's email to the payment provider
 * (fair-payments-connector's Privacy setting, #1484).
 *
 * @return {boolean} Current setting.
 */
export function ticketBuyerEmailSharing() {
	const value = wpCli('option get fair_payment_share_ticket_buyer_email', {
		allowFailure: true,
	}).trim();
	return value === '1';
}

/**
 * Turn sending ticket buyers' emails to the payment provider on or off.
 *
 * @param {boolean} enabled Whether buyer emails are sent.
 */
export function setTicketBuyerEmailSharing(enabled) {
	wpCli(
		`option update fair_payment_share_ticket_buyer_email ${enabled ? 1 : 0}`
	);
}

/**
 * Deadline for each login phase (opening the form, the submission's response,
 * the dashboard rendering). Short enough that a broken login fails the test
 * in seconds instead of running into the 60-second test timeout.
 */
export const LOGIN_PHASE_TIMEOUT = 5000;

const LOGIN_FIELDS = {
	user_login: 'username',
	user_pass: 'password',
};

/**
 * Replace every whole-word occurrence of the admin credentials in captured
 * page text, so login diagnostics never print them.
 *
 * @param {string} text Text captured from the page.
 * @return {string} Text with the credentials replaced by `[redacted]`.
 */
export function redactCredentials(text) {
	let result = `${text || ''}`.replace(/\s+/g, ' ').trim();
	for (const secret of [ADMIN_PASSWORD, ADMIN_USER]) {
		if (!secret) {
			continue;
		}
		const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		result = result.replace(
			new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`, 'g'),
			'[redacted]'
		);
	}
	return result;
}

/**
 * Current path of the page, for diagnostics (no query string or host).
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {string} Path.
 */
function currentPath(page) {
	try {
		return new URL(page.url()).pathname;
	} catch {
		return page.url();
	}
}

/**
 * Fail the login with a message prefixed so it is recognizable in reports.
 *
 * @param {string} reason Why the login failed.
 */
function loginFailure(reason) {
	throw new Error(`loginAsAdmin: ${reason}`);
}

/**
 * Describe the first field of the login form the browser would refuse to
 * submit, or null when the form is valid.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {Promise<string|null>} Field description and validation message.
 */
async function invalidLoginField(page) {
	return page.evaluate((fieldNames) => {
		const form = document.getElementById('loginform');
		const invalid = form?.querySelector(':invalid');
		if (!invalid) {
			return null;
		}
		const name =
			fieldNames[invalid.id] || invalid.id || invalid.name || 'unnamed';
		return `${name} field: ${invalid.validationMessage}`;
	}, LOGIN_FIELDS);
}

/**
 * Log into wp-admin as the configured admin and wait for the dashboard.
 *
 * Both credentials are written in one browser-side step, so wp-login.php's
 * delayed autofocus of the username field cannot redirect typing into the
 * wrong input. The form is submitted once; every phase has its own short
 * deadline, and a failure names its cause without printing the credentials.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 */
export async function loginAsAdmin(page) {
	const timeout = LOGIN_PHASE_TIMEOUT;

	let formResponse;
	try {
		formResponse = await page.goto('/wp-login.php', {
			timeout,
			waitUntil: 'domcontentloaded',
		});
	} catch (err) {
		loginFailure(
			`the login page did not load within ${timeout} ms (${err.message.split('\n')[0]})`
		);
	}
	if (formResponse && formResponse.status() >= 400) {
		loginFailure(
			`the login page returned HTTP ${formResponse.status()} at ${currentPath(page)}`
		);
	}
	try {
		await page.locator('#loginform').waitFor({ timeout });
	} catch {
		loginFailure(
			`no login form found at ${currentPath(page)} within ${timeout} ms`
		);
	}

	const fieldProblem = await page.evaluate(
		({ values, fieldNames }) => {
			const setValue = Object.getOwnPropertyDescriptor(
				window.HTMLInputElement.prototype,
				'value'
			).set;
			for (const [id, value] of Object.entries(values)) {
				const input = document.getElementById(id);
				if (!input) {
					return `the ${fieldNames[id]} field (#${id}) is missing`;
				}
				setValue.call(input, value);
				input.dispatchEvent(new Event('input', { bubbles: true }));
				input.dispatchEvent(new Event('change', { bubbles: true }));
			}
			for (const [id, value] of Object.entries(values)) {
				const actual = document.getElementById(id).value;
				if (actual === '') {
					return `the ${fieldNames[id]} field (#${id}) is empty after filling`;
				}
				if (actual !== value) {
					return `the ${fieldNames[id]} field (#${id}) does not hold the configured value after filling`;
				}
			}
			return null;
		},
		{
			values: { user_login: ADMIN_USER, user_pass: ADMIN_PASSWORD },
			fieldNames: LOGIN_FIELDS,
		}
	);
	if (fieldProblem) {
		loginFailure(`${fieldProblem}; not submitting`);
	}

	const invalidBeforeSubmit = await invalidLoginField(page);
	if (invalidBeforeSubmit) {
		loginFailure(
			`the browser would refuse to submit the form (${redactCredentials(invalidBeforeSubmit)})`
		);
	}

	// The document that ends the submission: WordPress's error page, the
	// re-rendered form, or the dashboard after the 302 redirect.
	const landing = page.waitForResponse(
		(response) =>
			response.request().isNavigationRequest() &&
			response.frame() === page.mainFrame() &&
			(response.status() < 300 || response.status() >= 400),
		{ timeout }
	);
	// Keep a rejected wait from surfacing as an unhandled rejection when the
	// click itself fails first.
	landing.catch(() => {});

	// Playwright's click waits for the navigation it starts, so a stalled
	// submission surfaces as a click timeout; tell the two apart by whether
	// the form was actually sent.
	let submitted = false;
	const onRequest = (request) => {
		if (
			request.isNavigationRequest() &&
			request.frame() === page.mainFrame() &&
			request.method() === 'POST'
		) {
			submitted = true;
		}
	};
	page.on('request', onRequest);
	try {
		await page.locator('#wp-submit').click({ timeout });
	} catch (err) {
		if (submitted) {
			loginFailure(
				`no response to the login submission within ${timeout} ms (current path: ${currentPath(page)})`
			);
		}
		loginFailure(
			`could not click the login button within ${timeout} ms (${err.message.split('\n')[0]})`
		);
	} finally {
		page.off('request', onRequest);
	}

	let response;
	try {
		response = await landing;
	} catch {
		const invalidAfterSubmit = await invalidLoginField(page).catch(
			() => null
		);
		if (invalidAfterSubmit) {
			loginFailure(
				`the browser refused to submit the form (${redactCredentials(invalidAfterSubmit)})`
			);
		}
		loginFailure(
			`no response to the login submission within ${timeout} ms (current path: ${currentPath(page)})`
		);
	}

	try {
		await page.waitForLoadState('domcontentloaded', { timeout });
	} catch {
		loginFailure(
			`the page after login did not load within ${timeout} ms (current path: ${currentPath(page)})`
		);
	}

	const path = currentPath(page);
	const loginError = page.locator('#login_error');
	if (await loginError.isVisible().catch(() => false)) {
		const text = await loginError.innerText().catch(() => '');
		loginFailure(
			`WordPress rejected the login: "${redactCredentials(text)}"`
		);
	}
	if (response.status() >= 400) {
		const body = await page
			.locator('body')
			.innerText()
			.catch(() => '');
		loginFailure(
			`the login submission returned HTTP ${response.status()} at ${path}: "${redactCredentials(body).slice(0, 200)}"`
		);
	}
	if (!/\/wp-admin\/?/.test(path)) {
		loginFailure(`login ended at an unexpected page: ${path}`);
	}
	try {
		await page.locator('#wpadminbar').waitFor({ timeout });
	} catch {
		loginFailure(
			`reached ${path} but the admin bar did not appear within ${timeout} ms`
		);
	}
}
