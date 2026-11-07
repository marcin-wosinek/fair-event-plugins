/**
 * Regression coverage for the shared `loginAsAdmin()` helper (#2162).
 *
 * The success cases log into the isolated WordPress instance for real. The
 * failure cases intercept the login page or its submission in the browser,
 * so the administrator's real credentials are never changed.
 */

import { test, expect } from '@playwright/test';
import {
	ADMIN_PASSWORD,
	ADMIN_USER,
	LOGIN_PHASE_TIMEOUT,
	loginAsAdmin,
} from './support/wp-cli.js';

const LOGIN_PAGE = /\/wp-login\.php(\?.*)?$/;

/** Upper bound for a failed login: every phase deadline plus slack. */
const FAILURE_BUDGET = 3 * LOGIN_PHASE_TIMEOUT + 2000;

/**
 * Serve the real login page with extra markup injected before `</body>`.
 *
 * @param {import('@playwright/test').Page} page   Playwright page.
 * @param {string}                          markup HTML to inject.
 */
async function injectIntoLoginPage(page, markup) {
	await page.route(LOGIN_PAGE, async (route) => {
		if (route.request().method() !== 'GET') {
			await route.fallback();
			return;
		}
		const response = await route.fetch();
		const body = (await response.text()).replace(
			'</body>',
			`${markup}</body>`
		);
		await route.fulfill({ response, body });
	});
}

/**
 * Intercept the login form submission (the POST to wp-login.php).
 *
 * @param {import('@playwright/test').Page}                            page    Playwright page.
 * @param {(route: import('@playwright/test').Route) => Promise<void>} handler Route handler.
 */
async function interceptSubmission(page, handler) {
	await page.route(LOGIN_PAGE, async (route) => {
		if (route.request().method() !== 'POST') {
			await route.fallback();
			return;
		}
		await handler(route);
	});
}

/**
 * Run `loginAsAdmin()` expecting it to fail; return its error and duration.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {Promise<{message: string, elapsed: number}>} Failure details.
 */
async function expectLoginFailure(page) {
	const started = Date.now();
	let error = null;
	try {
		await loginAsAdmin(page);
	} catch (err) {
		error = err;
	}
	const elapsed = Date.now() - started;
	expect(error, 'loginAsAdmin should have failed').not.toBeNull();
	expect(elapsed).toBeLessThan(FAILURE_BUDGET);
	return { message: error.message, elapsed };
}

/**
 * Assert a diagnostic does not print either credential. The helper's own
 * wording ("password field") is fixed text, so only the quoted part captured
 * from the page is checked when one is present.
 *
 * @param {string} message Error message.
 */
function expectNoCredentials(message) {
	const quoted = message.match(/"(.*)"/s)?.[1] ?? message;
	for (const secret of [ADMIN_USER, ADMIN_PASSWORD]) {
		const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
		expect(quoted).not.toMatch(
			new RegExp(`(?<![\\w-])${escaped}(?![\\w-])`)
		);
	}
}

test.describe('loginAsAdmin', () => {
	test.afterEach(async ({ page }) => {
		await page.unrouteAll({ behavior: 'ignoreErrors' });
	});

	test('logs in to the dashboard', async ({ page }) => {
		await loginAsAdmin(page);

		await expect(page).toHaveURL(/\/wp-admin\/?/);
		await expect(page.locator('#wpadminbar')).toBeVisible();
	});

	test('fills the right fields while autofocus keeps moving focus', async ({
		page,
	}) => {
		// Worse than wp-login.php's own autofocus: keep pulling focus to the
		// username field while the helper fills in the credentials.
		await injectIntoLoginPage(
			page,
			`<script>
				( function () {
					var input = document.getElementById( 'user_login' );
					var timer = setInterval( function () {
						input.focus();
						input.select();
					}, 5 );
					setTimeout( function () {
						clearInterval( timer );
					}, 3000 );
				} )();
			</script>`
		);

		let submitted = null;
		await interceptSubmission(page, async (route) => {
			submitted = new URLSearchParams(route.request().postData() || '');
			await route.continue();
		});

		await loginAsAdmin(page);

		await expect(page.locator('#wpadminbar')).toBeVisible();
		expect(submitted?.get('log')).toBe(ADMIN_USER);
		expect(submitted?.get('pwd')).toBe(ADMIN_PASSWORD);
	});

	test('names the WordPress error for rejected credentials', async ({
		page,
	}) => {
		let submissions = 0;
		await interceptSubmission(page, async (route) => {
			submissions++;
			const data = new URLSearchParams(route.request().postData() || '');
			data.set('pwd', `${ADMIN_PASSWORD}-wrong`);
			await route.continue({ postData: data.toString() });
		});

		const { message } = await expectLoginFailure(page);

		expect(message).toContain('WordPress rejected the login');
		expect(message).toContain('is incorrect');
		expectNoCredentials(message);
		expect(submissions, 'the helper must submit only once').toBe(1);
	});

	test('reports an empty field instead of submitting', async ({ page }) => {
		// Simulate input landing elsewhere: the password field drops whatever
		// is written into it.
		await injectIntoLoginPage(
			page,
			`<script>
				document.getElementById( 'user_pass' ).addEventListener( 'input', function ( event ) {
					event.target.value = '';
				} );
			</script>`
		);
		let submissions = 0;
		await interceptSubmission(page, async (route) => {
			submissions++;
			await route.continue();
		});

		const { message } = await expectLoginFailure(page);

		expect(message).toContain('password field (#user_pass) is empty');
		expect(message).not.toContain(`"`);
		expect(submissions).toBe(0);
	});

	test('reports a field the browser refuses to submit', async ({ page }) => {
		await injectIntoLoginPage(
			page,
			`<script>
				var extra = document.createElement( 'input' );
				extra.id = 'e2e_required_code';
				extra.required = true;
				document.getElementById( 'loginform' ).appendChild( extra );
			</script>`
		);
		let submissions = 0;
		await interceptSubmission(page, async (route) => {
			submissions++;
			await route.continue();
		});

		const { message } = await expectLoginFailure(page);

		expect(message).toContain('the browser would refuse to submit');
		expect(message).toContain('e2e_required_code field');
		expect(submissions).toBe(0);
	});

	test('reports an HTTP error page', async ({ page }) => {
		await interceptSubmission(page, (route) =>
			route.fulfill({
				status: 500,
				contentType: 'text/html',
				body: `<html><body><p>There has been a critical error. Login ${ADMIN_USER} / ${ADMIN_PASSWORD}.</p></body></html>`,
			})
		);

		const { message } = await expectLoginFailure(page);

		expect(message).toContain('returned HTTP 500');
		expect(message).toContain('critical error');
		expectNoCredentials(message);
	});

	test('reports a stalled submission within the deadline', async ({
		page,
	}) => {
		// Never answer the submission.
		await interceptSubmission(page, () => new Promise(() => {}));

		const { message } = await expectLoginFailure(page);

		expect(message).toContain(
			`no response to the login submission within ${LOGIN_PHASE_TIMEOUT} ms`
		);
		expect(message).toContain('/wp-login.php');
	});
});
