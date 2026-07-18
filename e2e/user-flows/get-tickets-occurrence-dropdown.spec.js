/**
 * E2E: single-occurrence dropdown in the base Event Signup form (fair-events
 * alone, no fair-audience/fair-form) — a recurring series with a
 * 'single_instance' ticket type offers a <select> of upcoming occurrences so
 * an anonymous visitor can pick which date they're signing up for, instead of
 * being silently registered for whichever occurrence the page resolved (#1190).
 *
 * fair-audience, fair-audience-experimental, and fair-events-experimental are
 * deactivated for this describe block so the base fair-events/event-signup
 * render path (render.php's own markup) is what's under test.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, runScript } from '../support/wp-cli.js';

test.describe('Occurrence dropdown for single-occurrence tickets (fair-events alone)', () => {
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

	test('single-session ticket: picking a non-default date registers the attendee against it', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('three-ticket-scopes', { price: 0 });
		const [firstOccurrenceId, , thirdOccurrenceId] = event.occurrenceIds;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		// Single-session ticket is the first enabled type, preselected by default.
		const ticketRadio = form.locator(
			`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
		);
		await expect(ticketRadio).toBeChecked();

		const dropdown = form.locator('.fair-events-occurrence-picker');
		await expect(dropdown).toBeVisible();

		const select = dropdown.locator('select[name="event_date_id_single"]');
		await expect(select.locator('option')).toHaveCount(3);
		// Defaults to the page's resolved occurrence (the series master, the
		// first upcoming one here).
		await expect(select).toHaveValue(String(firstOccurrenceId));

		await select.selectOption(String(thirdOccurrenceId));

		const stamp = Date.now();
		const email = `occurrence-dropdown.${stamp}@example.test`;
		await form
			.locator('input[name="name"]')
			.fill(`E2E Occurrence Dropdown ${stamp}`);
		await form.locator('input[name="email"]').fill(email);

		await form.locator('button[type="submit"]').click();
		await expect(
			page.getByText('You have successfully registered', { exact: false })
		).toBeVisible({ timeout: 15000 });

		const chosenState = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(thirdOccurrenceId)
		);
		expect(chosenState.signups).toHaveLength(1);
		expect(chosenState.signups[0].email).toBe(email);

		const defaultState = runScript(
			'get-tickets-state.php',
			'E2E_GT_STATE',
			String(firstOccurrenceId)
		);
		expect(defaultState.signups).toHaveLength(0);
	});

	test('whole-series and multi-occurrence tickets hide the dropdown; single-session brings it back', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('three-ticket-scopes');
		const [wholeSeriesTypeId, multiInstanceTypeId] = event.extraTypeIds;

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();

		const dropdown = form.locator('.fair-events-occurrence-picker');
		const instancePicker = form.locator('.fair-events-instance-picker');

		// Single-session (default) — dropdown visible, checkbox picker hidden.
		await expect(dropdown).toBeVisible();
		await expect(instancePicker).toBeHidden();

		// Whole-series pass — dropdown hidden.
		await form
			.locator(
				`input[name="ticket_type_id"][value="${wholeSeriesTypeId}"]`
			)
			.check();
		await expect(dropdown).toBeHidden();
		await expect(instancePicker).toBeHidden();

		// Multiple-instances pass — dropdown stays hidden, checkbox picker shows.
		await form
			.locator(
				`input[name="ticket_type_id"][value="${multiInstanceTypeId}"]`
			)
			.check();
		await expect(dropdown).toBeHidden();
		await expect(instancePicker).toBeVisible();

		// Back to single-session — dropdown reappears, checkbox picker hides.
		await form
			.locator(
				`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
			)
			.check();
		await expect(dropdown).toBeVisible();
		await expect(instancePicker).toBeHidden();
	});

	test('non-recurring event renders no occurrence dropdown', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('paid', { block: 'get-tickets' });

		await page.goto(event.pageUrl);

		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await expect(
			form.locator('.fair-events-occurrence-picker')
		).toHaveCount(0);
	});
});
