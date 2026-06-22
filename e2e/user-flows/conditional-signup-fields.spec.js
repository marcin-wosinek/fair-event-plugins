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
import { runScript } from '../support/wp-cli.js';

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
