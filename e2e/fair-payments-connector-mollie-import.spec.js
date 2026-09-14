import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from './support/wp-cli.js';

test.describe('Mollie transaction import', () => {
	test.beforeEach(() => {
		wpCli(
			'db query "DELETE FROM wp_fair_payment_transactions WHERE mollie_payment_id = \'tr_e2emanualimport\'"'
		);
	});

	test('imports a selected Mollie payment without an event association', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			'/wp-admin/admin.php?page=fair-payments-connector-transactions'
		);
		await page.getByRole('button', { name: 'Import', exact: true }).click();
		await page.getByRole('button', { name: 'Import from Mollie' }).click();
		await page.getByRole('button', { name: 'Find payments' }).click();
		await expect(page.getByText('E2E manual Mollie payment')).toBeVisible();
		await page.getByLabel('E2E manual Mollie payment').check();
		await page
			.getByRole('button', { name: 'Import selected payments' })
			.click();
		await expect(
			page.getByText(/Imported 1, skipped 0/).last()
		).toBeVisible();

		const state = runScript(
			'transaction-state.php',
			'E2E_TX_STATE',
			'tr_e2emanualimport'
		);
		expect(state.mollie_payment_id).toBe('tr_e2emanualimport');
		expect(state.post_id).toBeNull();
		expect(state.event_date_id).toBeNull();
	});
});
