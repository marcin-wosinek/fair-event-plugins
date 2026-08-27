/**
 * E2E: event-date `address` column — event-info block, calendar button,
 * recurrence (#721).
 *
 * Locks in three regressions that were already fixed on main but slipped
 * through review once (see the ticket): the event-info block ignoring
 * `address` when no venue is set, the calendar button hook doing the same,
 * and generated recurring children not inheriting the master's address.
 *
 * Each scenario seeds via `seedEvent('address', …)` inside the test body (not
 * `beforeAll`) so the fixture's per-test teardown (event + any venue) fires
 * automatically.
 *
 * Run: `npm run test:e2e -- fair-events-event-address`.
 */

import { test, expect } from './support/fixtures.js';
import { runScript } from './support/wp-cli.js';

test('single event: address renders with no venue set', async ({
	page,
	seedEvent,
}) => {
	const address = 'Calle Mayor 1, Madrid';
	// seedEvent creates the post first (triggering its undated placeholder),
	// then adds the configured future occurrence carrying this address. The
	// public render must resolve the configured occurrence, not the placeholder.
	const event = seedEvent('address', { address });

	await page.goto(event.pageUrl);

	await expect(
		page.locator('.wp-block-fair-events-event-info__venue-address')
	).toContainText(address);
	await expect(page.locator('[data-calendar-button="true"]')).toHaveAttribute(
		'data-location',
		address
	);
});

test('recurring master: generated children inherit and render the address', async ({
	page,
	seedEvent,
}) => {
	const address = 'Calle Mayor 1, Madrid';
	const event = seedEvent('address', { address, recurring: true });

	// No ?event_date= param — relies on SelectedOccurrence pivoting to the
	// upcoming generated child (the master itself is dated -10 days).
	await page.goto(event.pageUrl);

	await expect(
		page.locator('.wp-block-fair-events-event-info__venue-address')
	).toContainText(address);
	await expect(page.locator('[data-calendar-button="true"]')).toHaveAttribute(
		'data-location',
		address
	);

	const state = runScript(
		'event-date-address-state.php',
		'E2E_STATE',
		`${event.eventDateId}`
	);
	expect(state.masterAddress).toBe(address);
	expect(state.children.length).toBeGreaterThan(0);
	for (const child of state.children) {
		expect(child.address).toBe(address);
	}
});

test('editing the master address cascades to every generated child', async ({
	page,
	seedEvent,
}) => {
	const originalAddress = 'Calle Mayor 1, Madrid';
	const newAddress = 'Calle Nueva 42, Madrid';
	const event = seedEvent('address', {
		address: originalAddress,
		recurring: true,
	});

	const state = runScript(
		'event-date-address-state.php',
		'E2E_STATE',
		`${event.eventDateId} "${newAddress}"`
	);
	expect(state.masterAddress).toBe(newAddress);
	expect(state.children.length).toBeGreaterThan(0);
	for (const child of state.children) {
		expect(child.address).toBe(newAddress);
	}

	await page.goto(event.pageUrl);
	await expect(
		page.locator('.wp-block-fair-events-event-info__venue-address')
	).toContainText(newAddress);
});

test('venue wins over a stale address column', async ({ page, seedEvent }) => {
	const venueName = 'Test Hall';
	const venueAddress = 'Calle Venue 1';
	const event = seedEvent('address', {
		createVenue: true,
		venueName,
		venueAddress,
		address: 'stale address that must not render',
	});

	await page.goto(event.pageUrl);

	await expect(
		page.locator('.wp-block-fair-events-event-info__venue-name')
	).toContainText(venueName);
	await expect(
		page.locator('.wp-block-fair-events-event-info__venue-address')
	).toContainText(venueAddress);
	await expect(
		page.locator('.wp-block-fair-events-event-info__venue-address')
	).not.toContainText('stale address');

	await expect(page.locator('[data-calendar-button="true"]')).toHaveAttribute(
		'data-location',
		`${venueName}, ${venueAddress}`
	);
});
