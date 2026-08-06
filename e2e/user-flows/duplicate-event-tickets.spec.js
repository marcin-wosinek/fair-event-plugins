/**
 * Duplicate Event wizard — ticket-editor convergence (#1330).
 *
 * The wizard's Tickets step used to be an independent, drifted copy of the
 * Manage Event ticket editor: toggling "Multiple pricing periods" off during
 * duplication silently dropped sale-period data, and the wizard never sent
 * `recurrence_scope`, so series-scoped ticket types silently became
 * single_instance on the duplicate. Both are now impossible because the
 * wizard renders the same fair-events EventTickets component (imported
 * cross-plugin) that Manage Event uses.
 *
 * Covers the two concrete regressions named in the ticket's Risks section:
 *   - Duplicating an event carries over every ticket setting (types, sale
 *     periods, add-ons) unchanged.
 *   - Duplicating a series event preserves each ticket type's recurrence
 *     scope (single_instance / whole_series / multiple_instances).
 *
 * Group-restricted ticket types are not exercised here — no seed preset
 * builds one (fair-audience group + TicketType group_ids wiring), and that
 * sync path is unmodified by this change. Covered at the unit level instead.
 *
 * Run: `npm run test:e2e -- duplicate-event-tickets`.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, loginAsAdmin, runScript } from '../support/wp-cli.js';

/** Set the `fair_events_experimental_features` option to a `{bundle: bool}` map. */
function setExperimentalFeatures(map) {
	const json = JSON.stringify(map).replace(/'/g, "'\\''");
	wpCli(
		`option update fair_events_experimental_features '${json}' --format=json`
	);
}

function clearExperimentalFeatures() {
	wpCli('option delete fair_events_experimental_features', {
		allowFailure: true,
	});
}

function getTicketConfigState(eventDateId) {
	return runScript(
		'get-ticket-config-state.php',
		'E2E_TICKET_STATE',
		String(eventDateId)
	);
}

test.beforeEach(() => {
	// event-tools gates the duplicate-event page itself; ticketing gates the
	// wizard's Tickets step.
	setExperimentalFeatures({
		venues: true,
		sources: true,
		galleries: true,
		ticketing: true,
		'event-tools': true,
		migration: true,
	});
});

test.afterEach(() => {
	clearExperimentalFeatures();
});

/**
 * From the Tickets step (already reached by the caller), advances through
 * Audience and Group Rules and clicks "Create Duplicate", returning the new
 * event's (master) event_date_id.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {Promise<number>} The duplicate's event_date_id.
 */
async function finishFromTicketsStep(page) {
	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByText(/Step 3 \/ 4: Audience/)).toBeVisible();
	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByText(/Step 4 \/ 4: Group Rules/)).toBeVisible();

	await page.getByRole('button', { name: 'Create Duplicate' }).click();
	await page.waitForURL(/event_date_id=(\d+)/, { timeout: 30000 });

	const url = new URL(page.url());
	return parseInt(url.searchParams.get('event_date_id'), 10);
}

test('preserves sale periods and add-ons when duplicating a non-series event', async ({
	page,
	seedEvent,
}) => {
	const source = seedEvent('paid-with-options', {
		options: ['dinner', 'tshirt'],
	});

	await loginAsAdmin(page);
	await page.goto(
		`/wp-admin/admin.php?page=fair-events-duplicate-event&event_date_id=${source.eventDateId}`
	);
	await expect(page.getByText(/Step 1 \/ 4: Event Details/)).toBeVisible();

	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByText(/Step 2 \/ 4: Tickets/)).toBeVisible();
	// The ticket type row (always-visible table, not a collapsed panel).
	await expect(
		page.locator('input[value="General Admission"]')
	).toBeVisible();

	const newEventDateId = await finishFromTicketsStep(page);

	const sourceState = getTicketConfigState(source.eventDateId);
	const newState = getTicketConfigState(newEventDateId);

	expect(newState.ticket_types.map((t) => t.name)).toEqual(
		sourceState.ticket_types.map((t) => t.name)
	);
	expect(newState.sale_periods).toHaveLength(sourceState.sale_periods.length);
	expect(newState.options.map((o) => o.name).sort()).toEqual(
		sourceState.options.map((o) => o.name).sort()
	);
	expect(newState.options.map((o) => o.price).sort()).toEqual(
		sourceState.options.map((o) => o.price).sort()
	);
});

test('preserves each ticket type’s recurrence scope when duplicating a series event', async ({
	page,
	seedEvent,
}) => {
	const source = seedEvent('three-ticket-scopes');

	await loginAsAdmin(page);
	await page.goto(
		`/wp-admin/admin.php?page=fair-events-duplicate-event&event_date_id=${source.eventDateId}`
	);
	await expect(page.getByText(/Step 1 \/ 4: Event Details/)).toBeVisible();
	// Recurrence auto-detected from the source event's rrule.
	await expect(
		page.getByRole('checkbox', { name: /repeat|recur/i })
	).toBeChecked();

	await page.getByRole('button', { name: 'Next' }).click();
	await expect(page.getByText(/Step 2 \/ 4: Tickets/)).toBeVisible();
	// isSeries derived from the wizard's own recurrence state -> Scope column.
	await expect(page.getByText('Scope')).toBeVisible();

	const newEventDateId = await finishFromTicketsStep(page);

	const sourceState = getTicketConfigState(source.eventDateId);
	const newState = getTicketConfigState(newEventDateId);

	const scopesByName = (state) =>
		Object.fromEntries(
			state.ticket_types.map((t) => [t.name, t.recurrence_scope])
		);

	expect(scopesByName(newState)).toEqual(scopesByName(sourceState));
	expect(scopesByName(newState)).toEqual(
		expect.objectContaining({
			'Single Session': 'single_instance',
			'Full Series Pass': 'whole_series',
			'Pick your sessions': 'multiple_instances',
		})
	);
});
