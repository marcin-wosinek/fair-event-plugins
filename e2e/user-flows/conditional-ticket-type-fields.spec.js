/**
 * E2E: conditional signup fields keyed on the selected ticket type (#1349).
 *
 * Loads a public event whose Event Signup nests a Conditional Section
 * (conditionSource=ticketType, referencing the Adult ticket type) wrapping a
 * "Guardian contact" question. Asserts the real frontend show/hide logic in
 * shared/questionnaire.js: the question is hidden until the Adult ticket
 * type radio is selected, and hides again when a different type is picked.
 *
 * Everything here is production code — the block render callbacks emit the
 * ticket_type_id radios / data-condition-* attributes and the bundled
 * frontend.js evaluates them. See e2e/README.md for the harness mechanics.
 */

import { test, expect } from '@playwright/test';
import { runScript } from '../support/wp-cli.js';

let event;

test.beforeAll(() => {
	event = runScript('seed-conditional-ticket-type.php', 'E2E_SEED');
});

test.describe('conditional signup fields by ticket type', () => {
	test('reveals the question only while the referenced ticket type is selected', async ({
		page,
	}) => {
		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		const adultRadio = form.locator(
			`input[name="ticket_type_id"][value="${event.adultTypeId}"]`
		);
		const childRadio = form.locator(
			`input[name="ticket_type_id"][value="${event.childTypeId}"]`
		);
		await expect(adultRadio).toHaveCount(1);
		await expect(childRadio).toHaveCount(1);

		// The conditional wraps the "guardian" question; it is display:none
		// until the Adult ticket type is selected.
		const guardianQuestion = form.locator('[data-question-key="guardian"]');

		// Selecting the Child type keeps it hidden.
		await childRadio.check();
		await expect(guardianQuestion).toBeHidden();

		// Selecting the Adult type reveals it.
		await adultRadio.check();
		await expect(guardianQuestion).toBeVisible();

		// Switching back to Child hides it again.
		await childRadio.check();
		await expect(guardianQuestion).toBeHidden();
	});
});
