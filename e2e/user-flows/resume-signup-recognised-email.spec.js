/**
 * E2E: resume an anonymous signup on a recognised email (#1004), including
 * the anti-enumeration guard when the browser already holds a session for a
 * *different* participant.
 *
 * The API spec (EventSignupResume.api.spec.js) covers the register/resume
 * endpoints in isolation but only from a cookie-less request context, and
 * can't drive the emailed resume link at all. Here we go through the real
 * browser UI end to end:
 *
 *   1. The browser already has a fair_audience_session cookie for an
 *      unrelated participant (seeded directly — AudienceSession::set() can't
 *      be called from a CLI script, see seed-audience-session-cookie.php).
 *      That session pre-fills the anonymous form, proving the cookie is
 *      read, but its identity must NOT be reused for a different email.
 *   2. Typing a second, already-registered participant's email submits the
 *      form; since the session belongs to someone else, the server must
 *      stash the submission and email a resume link instead of signing
 *      anyone up (anti-enumeration — a guessed email can't be hijacked via
 *      an unrelated active session either).
 *   3. The resume link (extracted from the captured mail, since the dev
 *      stack has no real inbox) is visited for real; the form must restore
 *      into the authenticated "with_token" state and let the visitor
 *      complete the (paid) signup they originally filled in — through the
 *      real Mollie-double checkout/callback round trip, same as
 *      ticket-purchase-confirmation.spec.js.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

test.describe('event-signup block: resume anonymous signup on recognised email', () => {
	test('a session for another participant does not bypass the resume-by-email flow', async ({
		page,
		context,
		seedEvent,
	}) => {
		const event = seedEvent('paid');
		const stamp = Date.now();

		const recognisedEmail = `resume.recognised.${stamp}@example.test`;
		const recognised = runScript(
			'seed-known-participant.php',
			'E2E_PARTICIPANT',
			`'Resume Recognised ${stamp}' ${recognisedEmail}`
		);

		const sessionOwnerEmail = `resume.session-owner.${stamp}@example.test`;
		const sessionOwner = runScript(
			'seed-known-participant.php',
			'E2E_PARTICIPANT',
			`'Resume Session Owner ${stamp}' ${sessionOwnerEmail}`
		);

		const cookie = runScript(
			'seed-audience-session-cookie.php',
			'E2E_COOKIE',
			String(sessionOwner.participantId)
		);

		try {
			const pageUrl = new URL(event.pageUrl);
			await context.addCookies([
				{
					name: 'fair_audience_session',
					value: cookie.value,
					domain: pageUrl.hostname,
					path: '/',
				},
			]);

			// The session cookie pre-fills the anonymous form with the session
			// owner's details — proves the cookie is actually being read.
			await page.goto(event.pageUrl);
			const form = page.locator('.fair-audience-signup-register');
			await expect(form).toBeVisible();
			await expect(
				form.locator('input[name="signup_email"]')
			).toHaveValue(sessionOwnerEmail);

			// Overwrite with the OTHER, already-registered participant's email —
			// the session belongs to someone else, so this must not be treated
			// as an authenticated resubmission of that session's identity.
			await form
				.locator('input[name="signup_name"]')
				.fill('Resume Recognised Visitor');
			await form
				.locator('input[name="signup_email"]')
				.fill(recognisedEmail);
			const ticket = form.locator('input[name="ticket_type_id"]');
			await ticket.check();
			expect(
				Number(await ticket.getAttribute('data-ticket-price'))
			).toBeGreaterThan(0);

			await form.locator('.fair-audience-signup-submit-button').click();

			// Anti-enumeration response: generic "check your inbox" message, no
			// signup created, no session hijack.
			await expect(
				page.getByText('check your inbox', { exact: false })
			).toBeVisible();

			const state = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${recognisedEmail} ${event.eventDateId}`
			);
			expect(state.label).not.toBe('signed_up');

			// Pull the resume link out of the captured mail (no real inbox in
			// this stack) and follow it as the visitor would from their email
			// client.
			const resumeMail = state.mail.find((m) =>
				m.subject.includes('Continue registering')
			);
			expect(
				resumeMail,
				'a "Continue registering" resume email should be captured'
			).toBeTruthy();

			const participantTokenMatch = resumeMail.body.match(
				/participant_token=([^"&#]+)/
			);
			const resumeTokenMatch = resumeMail.body.match(/resume=([^"&#]+)/);
			expect(
				participantTokenMatch,
				'participant_token in resume email'
			).toBeTruthy();
			expect(
				resumeTokenMatch,
				'resume token in resume email'
			).toBeTruthy();

			await page.goto(
				`${event.pageUrl}?participant_token=${participantTokenMatch[1]}&resume=${resumeTokenMatch[1]}`
			);

			// The restored, authenticated form shows the "welcome back" notice
			// and lets the visitor finish the signup they originally filled in.
			await expect(
				page.getByText('restored your answers', { exact: false })
			).toBeVisible();

			// Complete the paid signup: the double's checkout link sends the
			// buyer straight back to the callback URL, which syncs "paid" from
			// the double on the reload (see ticket-purchase-confirmation.spec.js).
			const signupButton = page.locator('.fair-audience-signup-button');
			await expect(signupButton).toBeVisible();
			await signupButton.click();
			await expect(
				page.getByText('Payment confirmed', { exact: false })
			).toBeVisible({ timeout: 30000 });
			await expect(page).toHaveURL(/fair_payment_callback=true/);

			const finalState = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${recognisedEmail} ${event.eventDateId}`
			);
			expect(finalState.label).toBe('signed_up');
		} finally {
			runScript(
				'cleanup-participant.php',
				'E2E_PARTICIPANT_CLEANUP',
				String(recognised.participantId)
			);
			runScript(
				'cleanup-participant.php',
				'E2E_PARTICIPANT_CLEANUP',
				String(sessionOwner.participantId)
			);
		}
	});
});
