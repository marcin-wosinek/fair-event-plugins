/**
 * E2E: occurrence-picker visibility in the participant-aware Event Signup
 * form (fair-audience/event-signup) across all three ticket recurrence
 * scopes — single_instance, multiple_instances, whole_series.
 *
 * The picker toggling is entirely client-side (frontend.js
 * syncOccurrencePickers()), keyed off each ticket radio's
 * data-recurrence-scope attribute. A prior regression left the single-date
 * dropdown visible for a whole-series pass, and it went unnoticed because no
 * automated test exercised picker visibility. These tests assert on
 * effective visibility (not internal state) to stay durable across markup
 * refactors (#1178).
 */

import { test, expect } from '../support/fixtures.js';

test.describe('Occurrence pickers for all three ticket scopes (fair-audience)', () => {
	test('single-occurrence scope shows the date dropdown, not the checkbox picker', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('audience-ticket-scopes');

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-audience-signup-register');
		await expect(form).toBeVisible();

		const ticketRadio = form.locator(
			`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
		);
		await expect(ticketRadio).toBeChecked();

		await expect(
			page.locator('.fair-audience-occurrence-picker')
		).toBeVisible();
		await expect(
			form.locator('.fair-audience-instance-picker')
		).toBeHidden();
	});

	test('multiple-occurrence scope shows the checkbox picker, not the date dropdown', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('audience-ticket-scopes');
		const [, multiInstanceTypeId] = event.extraTypeIds;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-audience-signup-register');
		await expect(form).toBeVisible();

		await form
			.locator(
				`input[name="ticket_type_id"][value="${multiInstanceTypeId}"]`
			)
			.check();

		await expect(
			form.locator('.fair-audience-instance-picker')
		).toBeVisible();
		await expect(
			page.locator('.fair-audience-occurrence-picker')
		).toBeHidden();
	});

	test('whole-series scope shows neither picker', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('audience-ticket-scopes');
		const [wholeSeriesTypeId] = event.extraTypeIds;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-audience-signup-register');
		await expect(form).toBeVisible();

		await form
			.locator(
				`input[name="ticket_type_id"][value="${wholeSeriesTypeId}"]`
			)
			.check();

		await expect(
			page.locator('.fair-audience-occurrence-picker')
		).toBeHidden();
		await expect(
			form.locator('.fair-audience-instance-picker')
		).toBeHidden();
	});

	test('switching ticket types updates the visible picker live and clears a stale checkbox selection', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('audience-ticket-scopes');
		const [wholeSeriesTypeId, multiInstanceTypeId] = event.extraTypeIds;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-audience-signup-register');
		await expect(form).toBeVisible();

		const dropdown = page.locator('.fair-audience-occurrence-picker');
		const instancePicker = form.locator('.fair-audience-instance-picker');

		// Single-session (default) — dropdown visible, checkbox picker hidden.
		await expect(dropdown).toBeVisible();
		await expect(instancePicker).toBeHidden();

		// Whole-series pass — neither picker shown.
		await form
			.locator(
				`input[name="ticket_type_id"][value="${wholeSeriesTypeId}"]`
			)
			.check();
		await expect(dropdown).toBeHidden();
		await expect(instancePicker).toBeHidden();

		// Multiple-instances pass — checkbox picker shows.
		await form
			.locator(
				`input[name="ticket_type_id"][value="${multiInstanceTypeId}"]`
			)
			.check();
		await expect(instancePicker).toBeVisible();
		await expect(dropdown).toBeHidden();

		const [firstOccurrenceId] = event.occurrenceIds;
		const checkbox = instancePicker.locator(
			`input[name="event_date_ids[]"][value="${firstOccurrenceId}"]`
		);
		await checkbox.check();
		await expect(checkbox).toBeChecked();

		// Switch away to whole-series, then back — the stale checkbox
		// selection must not survive the round-trip.
		await form
			.locator(
				`input[name="ticket_type_id"][value="${wholeSeriesTypeId}"]`
			)
			.check();
		await form
			.locator(
				`input[name="ticket_type_id"][value="${multiInstanceTypeId}"]`
			)
			.check();
		await expect(instancePicker).toBeVisible();
		await expect(checkbox).not.toBeChecked();

		// Back to single-session — dropdown reappears, checkbox picker hides.
		await form
			.locator(
				`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
			)
			.check();
		await expect(dropdown).toBeVisible();
		await expect(instancePicker).toBeHidden();
	});

	test('regression: single + whole-series only (no multiple-occurrence type)', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('audience-ticket-scopes', {
			omitMulti: true,
		});
		const [wholeSeriesTypeId] = event.extraTypeIds;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-audience-signup-register');
		await expect(form).toBeVisible();

		const dropdown = page.locator('.fair-audience-occurrence-picker');

		// Single-session (default) — dropdown visible.
		await expect(dropdown).toBeVisible();

		// Whole-series pass — dropdown hidden; there is no instance picker at
		// all since this event has no multiple_instances ticket type.
		await form
			.locator(
				`input[name="ticket_type_id"][value="${wholeSeriesTypeId}"]`
			)
			.check();
		await expect(dropdown).toBeHidden();
		await expect(
			form.locator('.fair-audience-instance-picker')
		).toHaveCount(0);
	});
});
