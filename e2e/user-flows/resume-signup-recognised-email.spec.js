/**
 * E2E: resume a signup on a recognised email (#1004) through the Event Signup
 * block, including the guard when the browser already holds a session for a
 * *different* participant.
 *
 * The API spec (EventSignupResume.api.spec.js) covers the endpoints in
 * isolation but can't drive the emailed link. Here we go through the real
 * browser UI end to end:
 *
 *   1. The browser already has a fair_audience_session cookie for an
 *      unrelated participant (seeded directly — AudienceSession::set() can't
 *      be called from a CLI script, see seed-audience-session-cookie.php).
 *      That session pre-fills the form, proving the cookie is read, but its
 *      identity must NOT stand in for a different email.
 *   2. Typing a second, already-registered participant's email submits the
 *      form; since the session belongs to someone else, the server must
 *      stash the submission and email a link instead of signing anyone up —
 *      a guessed email can't be taken over through an unrelated session.
 *   3. The link (extracted from the captured mail, since the dev stack has no
 *      real inbox) is visited for real; the form must come back with the
 *      answers the visitor gave and let them complete the (paid) signup —
 *      through the real Mollie-double checkout/callback round trip, same as
 *      ticket-purchase-confirmation.spec.js.
 *   4. Opening the link again restores nothing.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

test.describe('event-signup block: resume a signup on a recognised email', () => {
	test('a session for another participant does not bypass the resume-by-email flow', async ({
		page,
		context,
		browser,
		seedEvent,
	}) => {
		const event = seedEvent('paid', { block: 'unified-with-question' });
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

			// The session cookie pre-fills the form with the session owner's
			// details — proves the cookie is actually being read.
			await page.goto(event.pageUrl);
			const form = page.locator('.fair-events-get-tickets-form');
			await expect(form).toBeVisible();
			await expect(form.locator('input[name="email"]')).toHaveValue(
				sessionOwnerEmail
			);

			// Overwrite with the OTHER, already-registered participant's email —
			// the session belongs to someone else, so this must not be treated
			// as that participant signing up.
			await form
				.locator('input[name="name"]')
				.fill('Resume Recognised Visitor');
			await form.locator('input[name="email"]').fill(recognisedEmail);
			await form
				.locator('[data-question-key="dietary"] input[type="text"]')
				.fill('No nuts');
			const ticket = form.locator('input[name="ticket_type_id"]');
			await ticket.check();
			expect(
				Number(await ticket.getAttribute('data-ticket-price'))
			).toBeGreaterThan(0);

			await form.locator('button[type="submit"]').click();

			// Generic "check your inbox" message, no signup created, no
			// session taken over.
			await expect(
				page.getByText('check your inbox', { exact: false })
			).toBeVisible();

			const state = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${recognisedEmail} ${event.eventDateId}`
			);
			expect(state.label).toBeNull();
			expect(state.transaction_id).toBeNull();

			// Pull the link out of the captured mail (no real inbox in this
			// stack) and follow it as the visitor would from their email client.
			const resumeMail = state.mail.find((m) =>
				m.subject.includes('Continue registering')
			);
			expect(
				resumeMail,
				'a "Continue registering" email should be captured'
			).toBeTruthy();

			const participantTokenMatch = resumeMail.body.match(
				/participant_token=([^"&#]+)/
			);
			const resumeTokenMatch = resumeMail.body.match(/resume=([^"&#]+)/);
			expect(
				participantTokenMatch,
				'participant_token in the email'
			).toBeTruthy();
			expect(resumeTokenMatch, 'resume token in the email').toBeTruthy();
			const resumeUrl = `${event.pageUrl}?participant_token=${participantTokenMatch[1]}&resume=${resumeTokenMatch[1]}`;

			// The inbox owner opens the link in their own browser.
			const ownerContext = await browser.newContext();
			const ownerPage = await ownerContext.newPage();
			try {
				await ownerPage.goto(resumeUrl);

				const ownerForm = ownerPage.locator(
					'.fair-events-get-tickets-form'
				);
				await expect(
					ownerPage.getByText('restored your answers', {
						exact: false,
					})
				).toBeVisible();
				await expect(
					ownerForm.locator('input[name="email"]')
				).toHaveValue(recognisedEmail);
				await expect(
					ownerForm.locator('input[name="name"]')
				).toHaveValue('Resume Recognised Visitor');
				await expect(
					ownerForm.locator(
						'[data-question-key="dietary"] input[type="text"]'
					)
				).toHaveValue('No nuts');

				// Complete the paid signup: the double's checkout link sends
				// the buyer straight back to the callback URL, which syncs
				// "paid" from the double on the reload.
				await ownerForm.locator('button[type="submit"]').click();
				await expect(
					ownerPage.getByText('Payment confirmed', { exact: false })
				).toBeVisible({ timeout: 30000 });
				await expect(ownerPage).toHaveURL(/fair_payment_callback=true/);
			} finally {
				await ownerContext.close();
			}

			const finalState = runScript(
				'signup-state.php',
				'E2E_STATE',
				`${recognisedEmail} ${event.eventDateId}`
			);
			expect(finalState.label).toBe('signed_up');

			// Opening the link again offers nothing to restore: the participant
			// now holds this signup, so their registration is shown instead.
			const reuseContext = await browser.newContext();
			const reusePage = await reuseContext.newPage();
			try {
				await reusePage.goto(resumeUrl);
				await expect(
					reusePage.locator('.fair-events-signed-up-card')
				).toBeVisible();
				await expect(
					reusePage.getByText('restored your answers', {
						exact: false,
					})
				).toHaveCount(0);
			} finally {
				await reuseContext.close();
			}
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
