/**
 * E2E: the Event Signup form submits each purchase with one idempotency key
 * (#1534), so a repeated submission cannot create a second signup.
 *
 * Covers what only the browser can show:
 *   - two submit events in a row send a single request;
 *   - a request whose response never arrives (the server did save the
 *     signup) is retried with the same key, and the visitor ends up with one
 *     signup, not two;
 *   - changing the purchase before submitting again starts a new key.
 *
 * What the server does with a key — capacity, payments, callbacks — is
 * covered by fair-events' GetTicketsIdempotency.api.spec.js.
 */

import { test, expect } from '../support/fixtures.js';

const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const isPurchaseRequest = (request) =>
	request.method() === 'POST' &&
	/get-tickets(\?|$)/.test(decodeURIComponent(request.url()));

// showMessage() swaps the message element's class for the outcome's.
const success = (page) =>
	page.locator('.fair-events-get-tickets-message-success');
const failure = (page) =>
	page.locator('.fair-events-get-tickets-message-error');

test.describe('Event Signup form: idempotent submission', () => {
	/**
	 * Open a seeded free event and fill in the buyer.
	 *
	 * @param {import('@playwright/test').Page} page  Page.
	 * @param {object}                          event Seeded event.
	 * @param {string}                          label Buyer label.
	 * @return {Promise<object>} form locator, submit locator and buyer email.
	 */
	async function openForm(page, event, label) {
		const email = `idempotent.${label}.${Date.now()}@example.test`;

		await page.goto(event.pageUrl);
		const form = page.locator('.fair-events-get-tickets-form');
		await expect(form).toBeVisible();
		await form.locator('input[name="name"]').fill(`Idempotent ${label}`);
		await form.locator('input[name="email"]').fill(email);
		await form
			.locator(
				`input[name="ticket_type_id"][value="${event.ticketTypeId}"]`
			)
			.check();

		// The viewer-context fetch releases the submit button once it settled.
		const submit = form.locator('button[type="submit"]');
		await expect(submit).toBeEnabled();

		return { form, submit, email };
	}

	async function signupsOf(page, event, email) {
		const res = await page.request.get(
			`/wp-json/fair-e2e/v1/checkout-keys?event_date_ids[]=${event.eventDateId}`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		return (await res.json()).signups.filter(
			(signup) => signup.email === email
		);
	}

	test('two submissions in a row send one request and create one signup', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free');
		const { form, email } = await openForm(page, event, 'double');

		const sent = [];
		page.on('request', (request) => {
			if (isPurchaseRequest(request)) {
				sent.push(request.postDataJSON());
			}
		});

		// Faster than any click: the second submit arrives while the first
		// request is still in flight.
		await form.evaluate((element) => {
			element.requestSubmit();
			element.requestSubmit();
		});

		await expect(success(page)).toContainText('successfully registered');

		expect(sent).toHaveLength(1);
		expect(sent[0].idempotency_key).toMatch(/^[a-f0-9]{32}$/);
		expect(await signupsOf(page, event, email)).toHaveLength(1);
	});

	test('a submission whose response was lost is retried with the same key and buys once', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free');
		const { submit, email } = await openForm(page, event, 'retry');
		const keys = [];
		let dropResponse = true;
		await page.route(/get-tickets/, async (route) => {
			const request = route.request();
			if (!isPurchaseRequest(request)) {
				return route.fallback();
			}
			keys.push(request.postDataJSON().idempotency_key);

			if (dropResponse) {
				// The server handles the request; the connection drops
				// before the browser hears back.
				dropResponse = false;
				await route.fetch();
				return route.abort('connectionreset');
			}
			return route.fallback();
		});

		await submit.click();
		await expect(failure(page)).toBeVisible();
		expect(await signupsOf(page, event, email)).toHaveLength(1);

		await expect(submit).toBeEnabled();
		await submit.click();
		await expect(success(page)).toContainText('successfully registered');

		expect(keys).toHaveLength(2);
		expect(keys[1]).toBe(keys[0]);
		expect(await signupsOf(page, event, email)).toHaveLength(1);
	});

	test('changing the purchase before submitting again starts a new key', async ({
		page,
		seedEvent,
	}) => {
		const event = seedEvent('free');
		const { form, submit, email } = await openForm(page, event, 'changed');
		const sent = [];
		let fail = true;
		await page.route(/get-tickets/, (route) => {
			const request = route.request();
			if (!isPurchaseRequest(request)) {
				return route.fallback();
			}
			sent.push(request.postDataJSON());

			if (fail) {
				// Never reaches the server.
				fail = false;
				return route.abort('connectionrefused');
			}
			return route.fallback();
		});

		await submit.click();
		await expect(failure(page)).toBeVisible();

		await form.locator('input[name="quantity"]').fill('2');
		await expect(submit).toBeEnabled();
		await submit.click();
		await expect(success(page)).toContainText('successfully registered');

		expect(sent).toHaveLength(2);
		expect(sent[1].quantity).toBe(2);
		expect(sent[1].idempotency_key).not.toBe(sent[0].idempotency_key);

		const signups = await signupsOf(page, event, email);
		expect(signups).toHaveLength(1);
		expect(signups[0].quantity).toBe(2);
	});
});
