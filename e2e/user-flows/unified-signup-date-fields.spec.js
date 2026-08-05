/**
 * E2E: signup with Date and Date & Time questions nested in the unified
 * Event Signup block (#1350). Both use the browser's native picker inputs
 * and must complete signup end to end, mirroring
 * unified-signup-url-question.spec.js for the URL question.
 */

import { test, expect } from '../support/fixtures.js';

test.describe('unified event-signup block: nested Date and Date & Time questions', () => {
	test('a free signup with a date and a date/time answer completes', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free', { block: 'unified-with-date-fields' });
		const stamp = Date.now();
		const email = `unified.date.${stamp}@example.test`;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		const dateQuestion = form.locator('[data-question-key="visit_date"]');
		await expect(dateQuestion).toBeVisible();
		await expect(dateQuestion).toContainText('Visit date');

		const datetimeQuestion = form.locator(
			'[data-question-key="appointment_slot"]'
		);
		await expect(datetimeQuestion).toBeVisible();
		await expect(datetimeQuestion).toContainText('Appointment slot');

		await form.locator('input[name="name"]').fill('Unified Visitor');
		await form.locator('input[name="email"]').fill(email);
		await dateQuestion.locator('input[type="date"]').fill('2026-09-01');
		await datetimeQuestion
			.locator('input[type="datetime-local"]')
			.fill('2026-09-01T14:30');

		await form.locator('.form-button').click();

		await expect(
			page.getByText('You have successfully registered', {
				exact: false,
			})
		).toBeVisible();
	});
});
