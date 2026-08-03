/**
 * E2E: ticket purchase happy path — confirmation email, marketing opt-in, and
 * the buyer's name on the admin participants list.
 *
 * Buys a paid ticket through the public unified event-signup block (the
 * default block seedEvent renders since the #1245 cutover; fair-audience
 * enriches the same render, it doesn't own a competing template) against the
 * isolated wp-env instance and asserts the buyer-facing AND organizer-facing
 * outcomes:
 *   - the purchase confirmation email is delivered (both opt-in cases),
 *   - a marketing (double opt-in) confirmation email is sent ONLY when the
 *     buyer ticks "Keep me informed", and
 *   - the buyer's name is visible on the per-event participants page in
 *     wp-admin (driven through the real admin UI, not a DB read).
 *
 * No real Mollie call or outbound mail happens. A test-only mu-plugin
 * (e2e/mu-plugins/) swaps the Mollie HTTP transport for a double that returns a
 * paid payment, and captures wp_mail into an option. Everything else — the
 * registration controller, the fair_payment_paid → signup-confirmation hook
 * chain, the email rendering, the admin React app — is the real production
 * code. The event is seeded (and torn down) by the `seedEvent` fixture. See
 * e2e/README.md for the mechanics.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript, loginAsAdmin } from '../support/wp-cli.js';

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
		test(scenario.name, async ({ page, seedEvent }) => {
			// Each scenario gets its own fresh, isolated paid event so the two
			// runs never share a participants list (and clean up afterwards).
			const event = seedEvent('paid');

			const stamp = Date.now();
			const buyerName = `E2E ${
				scenario.optIn ? 'OptIn' : 'OptOut'
			} ${stamp}`;
			const email = `buyer.${
				scenario.optIn ? 'optin' : 'optout'
			}.${stamp}@example.test`;

			// Public event page renders the signup block; the "I'm new"
			// registration form is shown by default for anonymous visitors.
			await page.goto(event.pageUrl);
			const form = page.locator('.fair-events-get-tickets-form');
			await expect(form).toBeVisible();

			// One paid ticket type is seeded and auto-selected; assert it carries
			// a positive price so the paid path (not the free path) is exercised.
			const ticket = form.locator('input[name="ticket_type_id"]');
			await ticket.check();
			expect(
				Number(await ticket.getAttribute('data-ticket-price'))
			).toBeGreaterThan(0);

			await form.locator('input[name="name"]').fill(buyerName);
			await form.locator('input[name="email"]').fill(email);
			if (scenario.optIn) {
				await form.locator('input[name="mailing_opt_in"]').check();
			}

			// Submit → register REST call returns payment_required with a
			// checkout_url that (via the Mollie double) points back at the signup
			// callback page, where sync pulls "paid" and fires the real chain.
			// Wait for the final confirmation UI rather than a specific mid-chain
			// navigation (waitForURL can abort with ERR_NETWORK_IO_SUSPENDED when a
			// redirect supersedes it), then assert the callback URL by polling.
			await form.locator('.form-button').click();
			await expect(
				page.getByText('Payment confirmed', { exact: false })
			).toBeVisible({ timeout: 30000 });
			await expect(page).toHaveURL(/fair_payment_callback=true/);

			// Server-side state: consent recorded per opt-in, row signed up, and
			// the captured mail for this buyer.
			const state = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${email} ${event.eventDateId}`
			);

			expect(state.found).toBe(true);
			expect(state.label).toBe('signed_up');
			expect(state.email_profile).toBe(scenario.expectedProfile);

			// The payment confirmation email goes out in both cases.
			const confirmation = state.mail.find((m) =>
				m.subject.includes('Signup confirmed')
			);
			expect(
				confirmation,
				'a "Signup confirmed" email should be captured for the buyer'
			).toBeTruthy();

			// Shared formatter fields (#1369): event date, registration
			// reference, ticket type, and (paid path) amount paid.
			expect(confirmation.body).toContain('Event date:');
			expect(confirmation.body).toContain('Registration reference:');
			expect(confirmation.body).toContain('Ticket type:');
			expect(confirmation.body).toContain('General Admission');
			expect(confirmation.body).toContain('Amount paid:');

			// The marketing (double opt-in) email is sent ONLY when opting in.
			const marketing = state.mail.find((m) =>
				m.subject.includes('Confirm your subscription')
			);
			if (scenario.optIn) {
				expect(
					marketing,
					'a "Confirm your subscription" email should be sent when opting in'
				).toBeTruthy();
			} else {
				expect(
					marketing,
					'no marketing email should be sent when opting out'
				).toBeFalsy();
			}

			// fair-events' own baseline confirmation (SignupEmailHooks) must not
			// also fire here — fair-audience is active, so it already sent the
			// richer "Signup confirmed" email above; a duplicate would show up
			// as extra captured mail beyond the two subjects asserted here.
			const ownBaselineConfirmation = state.mail.find((m) =>
				m.subject.includes('registration')
			);
			expect(
				ownBaselineConfirmation,
				'fair-events must not send its own confirmation when fair-audience is active'
			).toBeFalsy();

			// Organizer-facing: the buyer's name is on the per-event participants
			// page. Drive the real admin UI (React app fetching the participants
			// REST endpoint), not a DB read.
			await loginAsAdmin(page);
			await page.goto(
				`/wp-admin/admin.php?page=fair-audience-event-participants&event_date_id=${event.eventDateId}`
			);
			await expect(
				page.locator('#fair-audience-event-participants-root')
			).toBeVisible();
			await expect(page.getByText(buyerName)).toBeVisible();
		});
	}
});
