/**
 * E2E: manually enqueued scripts load with WordPress's native `defer`
 * strategy and still initialize (#877).
 *
 * Asserts on the script tags WordPress actually renders, not on the PHP
 * arguments: WordPress may legitimately fall back to a blocking tag, and the
 * Manage Event host must do so while an extension registers tabs from a
 * blocking dependent script.
 *
 * Run: `npm run test:e2e:local -- e2e/deferred-script-loading.spec.js`.
 */

import { test, expect } from './support/fixtures.js';
import { loginAsAdmin, runScript } from './support/wp-cli.js';

/**
 * Read how a script tag was rendered.
 *
 * @param {import('@playwright/test').Page} page   Playwright page.
 * @param {string}                          handle Script handle (without `-js`).
 * @return {Promise<{defer: boolean, async: boolean, inFooter: boolean, order: number}|null>} Tag state.
 */
async function scriptTag(page, handle) {
	return page.evaluate((id) => {
		const script = document.getElementById(id);
		if (!script) {
			return null;
		}
		return {
			defer: script.hasAttribute('defer'),
			async: script.hasAttribute('async'),
			inFooter: !script.closest('head'),
			order: [...document.scripts].indexOf(script),
		};
	}, `${handle}-js`);
}

/**
 * Collect console and page errors raised while a page is used.
 *
 * @param {import('@playwright/test').Page} page Playwright page.
 * @return {string[]} Live list of error messages.
 */
function collectErrors(page) {
	const errors = [];
	page.on('console', (message) => {
		if (message.type() === 'error') {
			errors.push(message.text());
		}
	});
	page.on('pageerror', (error) => errors.push(error.message));
	return errors;
}

test.describe('calendar button frontend script', () => {
	test('is deferred in the footer and opens the provider dropdown', async ({
		page,
		seedEvent,
	}) => {
		const errors = collectErrors(page);
		const event = seedEvent('address');

		await page.goto(event.pageUrl);

		expect(
			await scriptTag(page, 'fair-events-calendar-button-frontend')
		).toMatchObject({ defer: true, async: false, inFooter: true });

		await page.locator('a[data-calendar-button="true"]').click();
		await expect(page.locator('.calendar-dropdown')).toBeVisible();
		await expect(
			page.locator('.calendar-dropdown-option').first()
		).toBeVisible();
		expect(errors).toEqual([]);
	});
});

test.describe('payment callback script', () => {
	const seeded = [];

	const seedTransaction = (status) => {
		const transaction = runScript(
			'seed-callback-transaction.php',
			'E2E_CALLBACK_TX',
			status
		);
		seeded.push(transaction);
		return transaction;
	};

	const callbackUrl = (transaction, token = transaction.token) =>
		`/?fair_payment_callback=true&transaction_id=${transaction.transactionId}&token=${token}`;

	test.afterAll(() => {
		for (const transaction of seeded) {
			runScript(
				'cleanup-callback-transaction.php',
				'E2E_CALLBACK_TX_CLEANUP',
				String(transaction.transactionId)
			);
		}
	});

	for (const [status, type, text] of [
		['paid', 'success', 'has been successfully processed'],
		['pending_payment', 'info', 'is being processed'],
		['failed', 'error', 'was not completed'],
	]) {
		test(`is deferred in the footer and reports a ${status} payment`, async ({
			page,
		}) => {
			const errors = collectErrors(page);
			const transaction = seedTransaction(status);

			await page.goto(callbackUrl(transaction));

			expect(
				await scriptTag(page, 'fair-payments-connector-callback')
			).toMatchObject({ defer: true, async: false, inFooter: true });

			const notification = page.locator(
				`.fair-payments-connector-notification--${type}`
			);
			await expect(notification).toBeVisible();
			await expect(notification).toContainText(text);
			await expect(notification).toContainText(
				`${transaction.amount} ${transaction.currency}`
			);
			expect(errors).toEqual([]);
		});
	}

	test('reports an error when the status cannot be read', async ({
		page,
	}) => {
		const transaction = seedTransaction('paid');

		await page.goto(callbackUrl(transaction, 'not-the-token'));

		await expect(
			page.locator('.fair-payments-connector-notification--error')
		).toBeVisible();
	});
});

test.describe('admin scripts', () => {
	test('a standalone admin page is deferred and mounts', async ({ page }) => {
		const errors = collectErrors(page);
		await loginAsAdmin(page);

		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');

		expect(await scriptTag(page, 'fair-events-all-events')).toMatchObject({
			defer: true,
			inFooter: true,
		});
		await expect(
			page.locator('#fair-events-all-events-root > *').first()
		).toBeVisible();
		expect(errors).toEqual([]);
	});

	test('Manage Event stays blocking ahead of the Audience tab bundle', async ({
		page,
		seedEvent,
	}) => {
		const errors = collectErrors(page);
		const event = seedEvent('address');
		await loginAsAdmin(page);

		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${event.eventDateId}`
		);

		const host = await scriptTag(page, 'fair-events-manage-event');
		const audienceTab = await scriptTag(
			page,
			'fair-audience-manage-event-audience-tab'
		);

		// The Audience bundle registers its tab filter from a blocking
		// script, so WordPress must keep the host it depends on blocking
		// too — otherwise the host would mount before the filter exists.
		expect(host).toMatchObject({ defer: false, async: false });
		expect(audienceTab).toMatchObject({ defer: false, async: false });
		expect(audienceTab.order).toBeGreaterThan(host.order);

		await expect(
			page.getByRole('tab', { name: 'Audience', exact: true })
		).toBeVisible();
		expect(errors).toEqual([]);
	});
});
