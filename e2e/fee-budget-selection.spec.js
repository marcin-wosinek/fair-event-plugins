/**
 * E2E: an administrator links a new membership fee to a budget (#1802).
 *
 * The Create Fee dialog on Membership Fees lists the budgets kept in Fair
 * Finance. The administrator picks one, creates the fee, and after a reload
 * the fee still shows that budget — in the list and on its detail page.
 *
 * The budget and group are created through the admin REST API; they and the
 * fee are removed afterwards.
 */
import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USER, loginAsAdmin } from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const FEES_PAGE = '/wp-admin/admin.php?page=fair-audience-fees';

test.describe('Link a new membership fee to a budget', () => {
	const created = { feeId: 0, groupId: 0, budgetId: 0 };

	test.afterEach(async ({ request }) => {
		const remove = (path) =>
			request.delete(`/wp-json${path}`, { headers: adminHeaders });

		if (created.feeId) {
			await remove(`/fair-audience/v1/fees/${created.feeId}`);
		}
		if (created.groupId) {
			await remove(`/fair-audience/v1/groups/${created.groupId}`);
		}
		if (created.budgetId) {
			await remove(`/fair-finance/v1/budgets/${created.budgetId}`);
		}
	});

	test('creates a fee linked to the chosen budget and keeps the link', async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const feeName = `Budget Flow Fee ${stamp}`;
		const groupName = `Budget Flow Members ${stamp}`;
		const budgetName = `Budget Flow Budget ${stamp}`;

		const post = async (path, data) => {
			const res = await request.post(`/wp-json${path}`, {
				headers: adminHeaders,
				data,
			});
			expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
			return res.json();
		};

		created.budgetId = (
			await post('/fair-finance/v1/budgets', { name: budgetName })
		).id;
		created.groupId = (
			await post('/fair-audience/v1/groups', { name: groupName })
		).id;

		await loginAsAdmin(page);
		await page.goto(FEES_PAGE);

		// The dialog offers the budget by name, next to "No Budget".
		await page.getByRole('button', { name: 'Create Fee' }).click();
		const dialog = page.getByRole('dialog', { name: 'Create Fee' });
		const budget = dialog.getByRole('combobox', { name: 'Budget' });
		await expect(
			budget.getByRole('option', { name: budgetName })
		).toBeAttached();
		await expect(
			budget.getByRole('option', { name: '-- No Budget --' })
		).toBeAttached();
		await expect(
			dialog.getByText('Budgets could not be loaded.')
		).toBeHidden();

		await dialog.getByRole('textbox', { name: 'Name' }).fill(feeName);
		await dialog
			.getByRole('combobox', { name: 'Group' })
			.selectOption({ label: groupName });
		await dialog.getByRole('spinbutton', { name: 'Amount' }).fill('25');
		await budget.selectOption({ label: budgetName });

		const saved = page.waitForResponse(
			(res) =>
				res.request().method() === 'POST' &&
				/fair-audience\/v1\/fees(\?|$)/.test(
					decodeURIComponent(res.url())
				)
		);
		await dialog
			.getByRole('button', { name: 'Create', exact: true })
			.click();
		created.feeId = (await (await saved).json()).id;
		expect(created.feeId).toBeTruthy();
		await expect(dialog).toBeHidden();

		// After a reload the fee is still listed under that budget.
		await page.reload();
		const row = page.locator('tr', { hasText: feeName });
		await expect(row).toContainText(budgetName);

		// Reopening the fee shows the same budget.
		const link = row.getByRole('link', { name: feeName });
		await expect(link).toHaveAttribute(
			'href',
			`admin.php?page=fair-audience-fee-detail&fee_id=${created.feeId}`
		);
		await page.goto(
			`/wp-admin/admin.php?page=fair-audience-fee-detail&fee_id=${created.feeId}`
		);
		await expect(
			page.locator('div', { hasText: /^Budget:/ }).last()
		).toContainText(budgetName);

		// The stored link is the budget's ID.
		const res = await request.get(
			`/wp-json/fair-audience/v1/fees/${created.feeId}`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		expect(Number((await res.json()).budget_id)).toBe(created.budgetId);
	});
});
