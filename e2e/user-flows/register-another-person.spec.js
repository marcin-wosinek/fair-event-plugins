/**
 * E2E: a visitor the browser remembers registers another person (#1528)
 * through the Event Signup block.
 *
 * Participant A buys a ticket, which leaves the browser remembered as A (the
 * fair_audience_session cookie). From the card listing A's ticket they open a
 * fresh form for person B and complete it — once free, once through the
 * Mollie-double checkout round trip. B's signup, tickets and transaction must
 * be B's own, while A's ticket and the browser's session stay exactly as they
 * were: the page recognises A again as soon as the other person's form is
 * left or completed, and after a reload.
 *
 * Set CAPTURE_1528_SCREENSHOTS to a filename prefix (e.g. "after") to write
 * the ticket card and the other person's form at the three review viewports.
 */

import { test, expect } from '../support/fixtures.js';
import { runScript } from '../support/wp-cli.js';

const VIEWPORTS = [
	['desktop', 1280, 900],
	['tablet', 768, 1024],
	['mobile', 375, 812],
];

async function capture(page, name) {
	const prefix = process.env.CAPTURE_1528_SCREENSHOTS;
	if (!prefix) {
		return;
	}
	for (const [label, width, height] of VIEWPORTS) {
		await page.setViewportSize({ width, height });
		await page.screenshot({
			path: `${prefix}-${name}-${label}.png`,
			fullPage: true,
		});
	}
	await page.setViewportSize({ width: 1280, height: 900 });
}

async function sessionCookie(context) {
	const cookies = await context.cookies();
	return cookies.find((cookie) => cookie.name === 'fair_audience_session')
		?.value;
}

function ownership(event) {
	return runScript(
		'signup-ownership-state.php',
		'E2E_OWNERSHIP',
		String(event.eventDateId)
	).signups;
}

/**
 * Sign up participant A on a free ticket and reload, so the page shows the
 * card with their ticket — recognised through the session cookie alone.
 */
async function signUpOriginalParticipant(page, event, name, email) {
	await page.goto(event.pageUrl);
	const form = page.locator('.fair-events-get-tickets-form');
	await form.locator('input[name="name"]').fill(name);
	await form.locator('input[name="email"]').fill(email);
	await form.locator('button[type="submit"]').click();
	await expect(
		page.locator('.fair-events-get-tickets-message-success')
	).toBeVisible();

	await page.reload();
	await expect(page.locator('.fair-events-signed-up-card')).toBeVisible();
}

test.describe('event-signup block: registering another person', () => {
	test('a free registration belongs to the other person and leaves the original ticket and session alone', async ({
		page,
		context,
		seedEvent,
	}) => {
		const event = seedEvent('free');
		const stamp = Date.now();
		const originalEmail = `another.original.${stamp}@example.test`;
		const otherEmail = `another.other.${stamp}@example.test`;

		await signUpOriginalParticipant(
			page,
			event,
			'Original Holder',
			originalEmail
		);
		const cookie = await sessionCookie(context);
		expect(cookie).toBeTruthy();

		const card = page.locator('.fair-events-signed-up-card');
		const registerAnother = card.getByRole('button', {
			name: 'Register another person',
		});
		await expect(registerAnother).toBeVisible();
		// The two other identity choices stay what they were, and apart.
		await expect(
			page.getByRole('heading', {
				name: 'Buy another ticket for yourself',
			})
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Not you? Start fresh' })
		).toBeVisible();
		await expect(
			page.locator('.fair-events-get-tickets-form button[type="submit"]')
		).toBeEnabled();
		await capture(page, 'event-signup-ticket');

		// The fresh form: nothing of the original participant in it.
		await registerAnother.click();
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(
			form.getByRole('heading', { name: 'Registering another person' })
		).toBeVisible();
		await expect(form.locator('input[name="name"]')).toHaveValue('');
		await expect(form.locator('input[name="email"]')).toHaveValue('');
		await expect(card).toBeHidden();
		await expect(
			page.getByRole('heading', {
				name: 'Buy another ticket for yourself',
			})
		).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Not you? Start fresh' })
		).toHaveCount(0);
		await expect(form.locator('button[type="submit"]')).toBeEnabled();

		// It stays inside the page at every viewport.
		for (const [name, width, height] of VIEWPORTS) {
			await page.setViewportSize({ width, height });
			const layout = await page.evaluate(() => {
				const heading = document
					.querySelector('.fair-events-register-another-heading')
					.getBoundingClientRect();
				const back = document
					.querySelector('.fair-events-register-another-back')
					.getBoundingClientRect();
				return {
					overflow:
						document.documentElement.scrollWidth -
						document.documentElement.clientWidth,
					headingRight: heading.right,
					backRight: back.right,
				};
			});
			expect(layout.overflow, name).toBeLessThanOrEqual(0);
			expect(layout.headingRight, name).toBeLessThanOrEqual(width);
			expect(layout.backRight, name).toBeLessThanOrEqual(width);
		}
		await page.setViewportSize({ width: 1280, height: 900 });
		await capture(page, 'event-signup-another-person');

		// Leaving restores the original participant without a reload…
		await form.getByRole('button', { name: 'Back to your ticket' }).click();
		await expect(card).toBeVisible();
		await expect(
			page.locator('.fair-events-get-tickets-form input[name="email"]')
		).toHaveValue(originalEmail);
		expect(ownership(event)).toHaveLength(1);

		// …and the action can be taken again, through to a registration.
		await card
			.getByRole('button', { name: 'Register another person' })
			.click();
		await expect(form.locator('input[name="email"]')).toHaveValue('');
		await form.locator('input[name="name"]').fill('Other Person');
		await form.locator('input[name="email"]').fill(otherEmail);
		await form.locator('button[type="submit"]').click();

		// Confirmed, and back on the original participant's ticket view.
		await expect(
			page.locator('.fair-events-get-tickets-message-success')
		).toBeVisible();
		await expect(card).toBeVisible();
		await expect(
			card.locator('.fair-events-signed-up-tickets > li')
		).toHaveCount(1);
		await expect(
			page.locator('.fair-events-get-tickets-form input[name="email"]')
		).toHaveValue(originalEmail);
		await expect(
			page.locator('.fair-events-register-another-heading')
		).toHaveCount(0);

		// Two signups, each its own participant's.
		const signups = ownership(event);
		expect(signups).toHaveLength(2);
		const [original, other] = signups;
		expect(original.email).toBe(originalEmail);
		expect(original.participant_email).toBe(originalEmail);
		expect(other.email).toBe(otherEmail);
		expect(other.participant_email).toBe(otherEmail);
		expect(other.status).toBe('confirmed');
		expect(other.participant_id).not.toBe(original.participant_id);
		expect(other.ticket_purchaser_ids).toEqual([other.participant_id]);
		expect(original.ticket_purchaser_ids).toEqual([
			original.participant_id,
		]);

		const otherState = runScript(
			'signup-state.php',
			'E2E_STATE',
			`${otherEmail} ${event.eventDateId}`
		);
		expect(otherState.label).toBe('signed_up');
		expect(
			otherState.mail.some((m) => m.subject.includes('Signup confirmed'))
		).toBe(true);

		// The browser is still remembered as the original participant, on
		// this page and after a reload — the mode itself is not kept.
		expect(await sessionCookie(context)).toBe(cookie);
		await page.reload();
		await expect(card).toBeVisible();
		await expect(
			card.locator('.fair-events-signed-up-tickets > li')
		).toHaveCount(1);
		await expect(
			page.locator('.fair-events-get-tickets-form input[name="name"]')
		).toHaveValue('Original Holder');
		await expect(
			page.locator('.fair-events-register-another-heading')
		).toHaveCount(0);
	});

	test('a paid registration is the other person’s transaction; the browser returns as the original participant', async ({
		page,
		context,
		seedEvent,
	}) => {
		const event = seedEvent('paid');
		const stamp = Date.now();
		const originalEmail = `another.paid.original.${stamp}@example.test`;
		const otherEmail = `another.paid.other.${stamp}@example.test`;

		// The original participant buys their own ticket.
		await page.goto(event.pageUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await form.locator('input[name="ticket_type_id"]').check();
		await form.locator('input[name="name"]').fill('Paid Original');
		await form.locator('input[name="email"]').fill(originalEmail);
		await form.locator('.form-button').click();
		await expect(
			page.getByText('Payment confirmed', { exact: false })
		).toBeVisible({ timeout: 30000 });
		await page
			.getByRole('link', { name: 'Back to the signup form' })
			.click();

		const card = page.locator('.fair-events-signed-up-card');
		await expect(card).toBeVisible();
		const cookie = await sessionCookie(context);
		expect(cookie).toBeTruthy();

		// They register — and pay for — another person.
		await card
			.getByRole('button', { name: 'Register another person' })
			.click();
		await expect(
			form.getByRole('heading', { name: 'Registering another person' })
		).toBeVisible();
		const ticket = form.locator('input[name="ticket_type_id"]');
		await ticket.check();
		expect(
			Number(await ticket.getAttribute('data-ticket-price'))
		).toBeGreaterThan(0);
		await form.locator('input[name="name"]').fill('Paid Other');
		await form.locator('input[name="email"]').fill(otherEmail);
		await form.locator('.form-button').click();

		// The normal payment outcome, for the purchase just made.
		await expect(
			page.getByText('Payment confirmed', { exact: false })
		).toBeVisible({ timeout: 30000 });
		await expect(page).toHaveURL(/fair_payment_callback=true/);

		const signups = ownership(event);
		expect(signups).toHaveLength(2);
		const [original, other] = signups;
		expect(original.participant_email).toBe(originalEmail);
		expect(other.email).toBe(otherEmail);
		expect(other.participant_email).toBe(otherEmail);
		expect(other.status).toBe('confirmed');
		expect(other.participant_id).not.toBe(original.participant_id);
		// A transaction of its own, linked to the other person.
		expect(other.transaction_id).toBeTruthy();
		expect(other.transaction_id).not.toBe(original.transaction_id);
		expect(other.transaction_status).toBe('paid');
		expect(other.transaction_participant_id).toBe(other.participant_id);
		expect(original.transaction_participant_id).toBe(
			original.participant_id
		);
		expect(other.ticket_purchaser_ids).toEqual([other.participant_id]);

		// Outside that purchase the browser is the original participant.
		expect(await sessionCookie(context)).toBe(cookie);
		await page
			.getByRole('link', { name: 'Back to the signup form' })
			.click();
		await expect(card).toBeVisible();
		await expect(
			card.locator('.fair-events-signed-up-tickets > li')
		).toHaveCount(1);
		await expect(
			page.locator('.fair-events-get-tickets-form input[name="email"]')
		).toHaveValue(originalEmail);
	});
});
