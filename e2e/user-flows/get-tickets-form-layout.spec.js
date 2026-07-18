/**
 * E2E: base Event Signup form layout (fair-events alone, no other Fair
 * Event plugin active) — the ticket-type radio group precedes name/email
 * with the first available type preselected, and the occurrence picker sits
 * directly beneath the ticket section (#1187).
 *
 * fair-audience, fair-audience-experimental, and fair-events-experimental
 * are all deactivated for this describe block so the base
 * fair-events/event-signup render path (render.php's own markup, not the
 * fair-audience delegation) is what's under test — mirroring the "fair-events
 * only" combination in e2e/screenshots/event-signup-combinations.spec.js.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli } from '../support/wp-cli.js';

test.describe('Event Signup form layout (fair-events alone)', () => {
	test.beforeAll(() => {
		wpCli(
			'plugin deactivate fair-audience fair-audience-experimental fair-events-experimental'
		);
	});

	test.afterAll(() => {
		wpCli(
			'plugin activate fair-audience fair-audience-experimental fair-events-experimental'
		);
	});

	test('ticket type radio group renders before name/email, first available type preselected', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid', { block: 'get-tickets' });

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		// A plain <select> must be gone from the ticket section.
		await expect(form.locator('select[name="ticket_type_id"]')).toHaveCount(
			0
		);

		const fieldset = form.locator('.fair-events-ticket-fieldset');
		await expect(fieldset).toBeVisible();
		await expect(fieldset.locator('legend')).toHaveText(
			'Choose ticket type'
		);

		const ticketRadio = form.locator(
			`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
		);
		await expect(ticketRadio).toBeChecked();

		// DOM order: the ticket fieldset markup precedes both the name and
		// email fields.
		const html = await form.innerHTML();
		const fieldsetIndex = html.indexOf('fair-events-ticket-fieldset');
		const nameIndex = html.indexOf('name="name"');
		const emailIndex = html.indexOf('name="email"');
		expect(fieldsetIndex).toBeGreaterThan(-1);
		expect(fieldsetIndex).toBeLessThan(nameIndex);
		expect(fieldsetIndex).toBeLessThan(emailIndex);
	});

	test('occurrence picker sits directly after the ticket section, ahead of name/email', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('three-ticket-scopes');
		const multiInstanceTypeId = event.extraTypeIds[1];

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		const html = await form.innerHTML();
		const fieldsetIndex = html.indexOf('fair-events-ticket-fieldset');
		const pickerIndex = html.indexOf('fair-events-instance-picker');
		const nameIndex = html.indexOf('name="name"');
		expect(pickerIndex).toBeGreaterThan(-1);
		expect(pickerIndex).toBeGreaterThan(fieldsetIndex);
		expect(pickerIndex).toBeLessThan(nameIndex);

		// Hidden until the multiple_instances ticket type is selected.
		const instancePicker = form.locator('.fair-events-instance-picker');
		await expect(instancePicker).toBeHidden();

		await form
			.locator(
				`input[name="ticket_type_id"][value="${multiInstanceTypeId}"]`
			)
			.check();
		await expect(instancePicker).toBeVisible();
	});
});
