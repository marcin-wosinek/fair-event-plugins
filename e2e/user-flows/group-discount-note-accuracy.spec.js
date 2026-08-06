/**
 * E2E: the group discount note above the signup button must match the price
 * actually shown/charged (#1297).
 *
 * Targets fair-audience's own event-signup block — the one variant that
 * resolves the viewer synchronously from a `?participant_token=` URL, so a
 * seeded member's personalized note and price are present in the very first
 * server-rendered page (no cookie/login choreography needed). The unified
 * fair-events/event-signup block (the default for new content since #1245)
 * shares the same underlying resolver (SignupHookBridge::enrich_render_context,
 * covered by the fix in this PR) but personalizes via an async viewer-context
 * fetch, which needs a different testing technique — left to a follow-up.
 *
 * Each case seeds a single ticket type plus a group discount rule via
 * seed-group-discount-note-event.php (real fair-audience/fair-events-experimental
 * models, no HTTP round-trip), and reads the resolved price straight off the
 * ticket-type radio's `data-ticket-price` attribute — a locale-independent
 * numeric string — rather than parsing currency-formatted text, so the
 * assertion doesn't depend on the site's currency/locale settings.
 */

import { test, expect } from '@playwright/test';
import { runScript } from '../support/wp-cli.js';

function seed(overrides) {
	return runScript(
		'seed-group-discount-note-event.php',
		'E2E_SEED',
		`'${JSON.stringify(overrides)}'`
	);
}

function cleanup(event) {
	runScript(
		'cleanup-group-discount-note-event.php',
		'E2E_CLEANUP',
		`${event.eventId} ${event.eventDateId} ${event.participantId} ${event.groupId} ${event.ruleId}`
	);
}

test.describe('Group discount note accuracy', () => {
	test('a percentage rule: the note and the shown price agree', async ({
		page,
	}) => {
		const event = seed({
			price: 20,
			discountType: 'percentage',
			discountValue: 20,
		});
		try {
			await page.goto(event.pageUrl);

			const note = page.locator('.fair-audience-signup-discount-note');
			await expect(note).toBeVisible();
			await expect(note).toContainText('20% discount applied');

			const radio = page.locator('input[name="ticket_type_id"]');
			await expect(radio).toHaveAttribute('data-ticket-price', '16.00');
		} finally {
			cleanup(event);
		}
	});

	test('an amount rule: the note and the shown price agree', async ({
		page,
	}) => {
		const event = seed({
			price: 20,
			discountType: 'amount',
			discountValue: 5,
		});
		try {
			await page.goto(event.pageUrl);

			const note = page.locator('.fair-audience-signup-discount-note');
			await expect(note).toBeVisible();
			await expect(note).toContainText('discount applied');

			const radio = page.locator('input[name="ticket_type_id"]');
			await expect(radio).toHaveAttribute('data-ticket-price', '15.00');
		} finally {
			cleanup(event);
		}
	});

	test('a fractional percentage renders with its decimals, not rounded', async ({
		page,
	}) => {
		const event = seed({
			price: 20,
			discountType: 'percentage',
			discountValue: 12.5,
		});
		try {
			await page.goto(event.pageUrl);

			const note = page.locator('.fair-audience-signup-discount-note');
			await expect(note).toContainText('12.5% discount applied');

			const radio = page.locator('input[name="ticket_type_id"]');
			await expect(radio).toHaveAttribute('data-ticket-price', '17.50');
		} finally {
			cleanup(event);
		}
	});

	test('a free tier shows no note, even for a member with a matching rule', async ({
		page,
	}) => {
		const event = seed({
			price: 0,
			discountType: 'percentage',
			discountValue: 20,
		});
		try {
			await page.goto(event.pageUrl);

			await expect(
				page.locator('.fair-audience-signup-discount-note')
			).toHaveCount(0);

			const radio = page.locator('input[name="ticket_type_id"]');
			await expect(radio).toHaveAttribute('data-ticket-price', '0.00');
		} finally {
			cleanup(event);
		}
	});
});
