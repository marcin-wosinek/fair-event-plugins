/**
 * E2E: ticket purchase → confirmation email + marketing opt-in.
 *
 * Buys a paid ticket through the public event-signup block against the isolated
 * wp-env instance and asserts the buyer-facing outcome:
 *   - the purchase confirmation email is delivered (both opt-in cases), and
 *   - marketing consent (email_profile = 'marketing') is recorded ONLY when the
 *     buyer ticks "Keep me informed".
 *
 * No real Mollie call or outbound mail happens. A test-only mu-plugin
 * (e2e/mu-plugins/) swaps the Mollie HTTP transport for a double that returns a
 * paid payment, and captures wp_mail into an option. Everything else — the
 * registration controller, the fair_payment_paid → signup-confirmation hook
 * chain, the email rendering — is the real production code. See
 * e2e/README.md for the mechanics.
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

/** Clear captured mail so each scenario starts clean. */
function resetCapturedMail() {
	try {
		wpCli('option delete fair_e2e_captured_mail');
	} catch {
		// Option may not exist yet — nothing to clear.
	}
}

let event;

test.beforeAll(() => {
	event = runScript('seed-paid-event.php', 'E2E_SEED');
});

const scenarios = [
	{
		name: 'records marketing consent when the buyer opts in',
		optIn: true,
		expectedProfile: 'marketing',
	},
	{
		name: 'does not record marketing consent when the buyer opts out',
		optIn: false,
		expectedProfile: 'minimal',
	},
];

test.describe('ticket purchase confirmation', () => {
	for (const scenario of scenarios) {
		test(scenario.name, async ({ page }) => {
			resetCapturedMail();
			const email = `buyer.${
				scenario.optIn ? 'optin' : 'optout'
			}.${Date.now()}@example.test`;

			// Public event page renders the signup block; the "I'm new"
			// registration form is shown by default for anonymous visitors.
			await page.goto(event.pageUrl);
			const form = page.locator('.fair-audience-signup-register');
			await expect(form).toBeVisible();

			// One paid ticket type is seeded and auto-selected; assert it carries
			// a positive price so the paid path (not the free path) is exercised.
			const ticket = form.locator('input[name="ticket_type_id"]');
			await ticket.check();
			expect(
				Number(await ticket.getAttribute('data-ticket-price'))
			).toBeGreaterThan(0);

			await form.locator('input[name="signup_name"]').fill('E2E Buyer');
			await form.locator('input[name="signup_email"]').fill(email);
			if (scenario.optIn) {
				await form
					.locator('input[name="signup_keep_informed"]')
					.check();
			}

			// Submit → register REST call returns payment_required with a
			// checkout_url that (via the Mollie double) points back at the signup
			// callback page, where sync pulls "paid" and fires the real chain.
			await form.locator('.fair-audience-signup-submit-button').click();
			await page.waitForURL(/fair_payment_callback=true/);
			await expect(
				page.getByText('Payment confirmed', { exact: false })
			).toBeVisible();

			// Server-side assertions: consent recorded per opt-in, row signed up,
			// and the confirmation email captured for this buyer.
			const state = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${email} ${event.eventDateId}`
			);

			expect(state.found).toBe(true);
			expect(state.label).toBe('signed_up');
			expect(state.email_profile).toBe(scenario.expectedProfile);

			const confirmation = state.mail.find((m) =>
				m.subject.includes('Signup confirmed')
			);
			expect(
				confirmation,
				'a "Signup confirmed" email should be captured for the buyer'
			).toBeTruthy();
		});
	}
});
