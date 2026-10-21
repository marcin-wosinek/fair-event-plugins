/**
 * Payment Transactions — import failure and retry (#1934).
 *
 * Choosing a file starts the import. While it runs, the popup cannot be
 * dismissed by Escape, Cancel or the External Updates link. When the request
 * fails, the popup keeps the parsed file and offers "Retry import", which
 * sends the same transactions without choosing the file again. Every import
 * request is intercepted with a fake answer, so nothing is stored.
 *
 * Run: `npm run test:e2e:local -- e2e/payment-transactions-import-retry.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

const PAGE_PATH =
	'/wp-admin/admin.php?page=fair-payments-connector-transactions';
const IMPORT = /transactions(\/|%2F)import/;

test('an organizer retries a failed import without choosing the file again', async ({
	page,
}) => {
	const transactions = [
		{ mollie_payment_id: 'tr_e2e_retry', amount: '15.00', currency: 'EUR' },
	];
	const bodies = [];
	let releaseFirst;
	const firstAnswered = new Promise((resolve) => {
		releaseFirst = resolve;
	});
	await page.route(IMPORT, async (route) => {
		bodies.push(route.request().postDataJSON());
		if (bodies.length === 1) {
			// Hold the first attempt to look at the pending popup.
			await firstAnswered;
			await route.fulfill({
				status: 500,
				contentType: 'application/json',
				body: JSON.stringify({
					code: 'import_failed',
					message: 'The transactions could not be saved.',
					data: { status: 500 },
				}),
			});
			return;
		}
		await route.fulfill({
			status: 200,
			contentType: 'application/json',
			body: JSON.stringify({ message: 'Imported 1 new transaction.' }),
		});
	});

	await loginAsAdmin(page);
	await page.goto(PAGE_PATH);
	const trigger = page.getByRole('button', { name: 'Import', exact: true });
	await trigger.click();
	const dialog = page.getByRole('dialog', { name: 'Import Transactions' });

	await dialog.locator('input[type="file"]').setInputFiles({
		name: 'transactions.json',
		mimeType: 'application/json',
		buffer: Buffer.from(JSON.stringify(transactions)),
	});

	await expect(dialog.getByText('Importing…')).toBeVisible();
	await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeDisabled();
	await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(0);
	await expect(
		dialog.getByRole('link', { name: 'Open External Updates' })
	).toHaveAttribute('aria-disabled', 'true');
	await page.keyboard.press('Escape');
	await expect(dialog).toBeVisible();
	// Playwright refuses aria-disabled targets; force the click to prove the
	// link does not navigate away.
	await dialog
		.getByRole('link', { name: 'Open External Updates' })
		.click({ force: true });
	await expect(page).toHaveURL(/fair-payments-connector-transactions/);
	await expect(dialog).toBeVisible();

	releaseFirst();
	await expect(
		dialog.getByText('The transactions could not be saved.')
	).toBeVisible();
	await expect(
		dialog.getByText(
			'transactions.json: 1 transaction is ready to import again.'
		)
	).toBeVisible();

	await dialog.getByRole('button', { name: 'Retry import' }).click();
	await expect(dialog).toBeHidden();
	await expect(
		page
			.locator('.components-notice__content')
			.getByText('Imported 1 new transaction.')
	).toBeVisible();
	await expect(trigger).toBeFocused();
	expect(bodies).toHaveLength(2);
	expect(bodies[1]).toEqual(bodies[0]);
	expect(bodies[1].transactions).toEqual(transactions);
});
