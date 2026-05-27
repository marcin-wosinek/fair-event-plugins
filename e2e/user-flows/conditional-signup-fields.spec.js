/**
 * E2E: conditional signup fields keyed on an event option's short name (#681).
 *
 * Loads a public event whose Event Signup nests a Conditional Section
 * (conditionSource=eventOption, short name "dinner") wrapping a "Dietary
 * restrictions" question. Asserts the real frontend show/hide logic in
 * shared/questionnaire.js: the question is hidden until the matching option
 * checkbox is ticked, and hides again when it is unticked.
 *
 * Everything here is production code — the block render callbacks emit the
 * data-option-short-name / data-condition-* attributes and the bundled
 * frontend.js evaluates them. See e2e/README.md for the harness mechanics.
 */

import { test, expect } from '@playwright/test';
import { execSync } from 'node:child_process';

/**
 * Run a WP-CLI command against the wp-env `tests` instance and return stdout.
 *
 * @param {string} args WP-CLI arguments (everything after `wp`).
 * @return {string} Command stdout.
 */
function wpCli(args) {
	return execSync(`npx wp-env run tests-cli wp ${args}`, {
		cwd: process.cwd(),
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe'],
	});
}

/**
 * Run a seed/state eval-file script and parse its `MARKER:{json}` output.
 *
 * @param {string} file      Script filename under mu-plugins/scripts/.
 * @param {string} marker    Output marker (e.g. 'E2E_SEED').
 * @param {string} extraArgs Positional args passed to the script.
 * @return {object} Parsed JSON payload.
 */
function runScript(file, marker, extraArgs = '') {
	const out = wpCli(
		`eval-file wp-content/mu-plugins/scripts/${file} ${extraArgs}`.trim()
	);
	const match = out.match(new RegExp(`${marker}:(\\{.*\\})`));
	if (!match) {
		throw new Error(`Expected ${marker} in WP-CLI output, got:\n${out}`);
	}
	return JSON.parse(match[1]);
}

let event;

test.beforeAll(() => {
	event = runScript('seed-conditional-signup.php', 'E2E_SEED');
});

test.describe('conditional signup fields by event-option short name', () => {
	test('reveals the question only while the matching option is selected', async ({
		page,
	}) => {
		await page.goto(event.pageUrl);

		// Anonymous visitors get the registration form by default.
		const form = page.locator('.fair-audience-signup-register');
		await expect(form).toBeVisible();

		const dinner = form.locator(
			'input[name="ticket_option_ids[]"][data-option-short-name="dinner"]'
		);
		await expect(dinner).toHaveCount(1);

		// The conditional wraps the "diet" question; it is display:none until
		// the controlling option is checked.
		const dietQuestion = form.locator('[data-question-key="diet"]');

		// Hidden on load.
		await expect(dietQuestion).toBeHidden();

		// Selecting "dinner" reveals it.
		await dinner.check();
		await expect(dietQuestion).toBeVisible();

		// Unselecting hides it again.
		await dinner.uncheck();
		await expect(dietQuestion).toBeHidden();
	});
});
