/**
 * E2E: an administrator links a new membership fee to a budget (#1802).
 *
 * The Create Fee dialog on Membership Fees lists the budgets kept in Fair
 * Finance. The administrator picks one, creates the fee, and after a reload
 * the fee still shows that budget — in the list and on its detail page.
 *
 * In Edit Fee the administrator moves a fee to another budget and then
 * clears it; each choice is still there after a reload. With Fair Finance
 * deactivated neither dialog shows budget controls, and saving a fee keeps
 * the budget it was linked to.
 *
 * The budgets and group are created through the admin REST API; they and the
 * fee are removed afterwards.
 */
import { test, expect } from '@playwright/test';
import {
	ADMIN_PASSWORD,
	ADMIN_USER,
	loginAsAdmin,
	wpCli,
} from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const FEES_PAGE = '/wp-admin/admin.php?page=fair-audience-fees';

test.describe('Link a new membership fee to a budget', () => {
	const created = { feeId: 0, groupId: 0, budgetId: 0, otherBudgetId: 0 };

	const post = async (request, path, data) => {
		const res = await request.post(`/wp-json${path}`, {
			headers: adminHeaders,
			data,
		});
		expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
		return res.json();
	};

	const storedBudgetId = async (request) => {
		const res = await request.get(
			`/wp-json/fair-audience/v1/fees/${created.feeId}`,
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		return (await res.json()).budget_id;
	};

	/** Open Edit Fee from the fee's row actions. */
	const openEditDialog = async (page, feeName) => {
		const row = page.locator('tr', { hasText: feeName });
		await row.getByRole('button', { name: 'Actions' }).click();
		await page.getByRole('menuitem', { name: 'Edit' }).click();
		return page.getByRole('dialog', { name: 'Edit Fee' });
	};

	/** Press Update and wait for the fee to be saved. */
	const saveEdit = async (page, dialog) => {
		// apiFetch sends a PUT as a POST with a method override header.
		const saved = page.waitForResponse(
			(res) =>
				res.request().method() !== 'GET' &&
				decodeURIComponent(res.url()).includes(
					`fair-audience/v1/fees/${created.feeId}`
				)
		);
		await dialog.getByRole('button', { name: 'Update' }).click();
		expect((await saved).ok()).toBeTruthy();
		await expect(dialog).toBeHidden();
	};

	test.afterEach(async ({ request }) => {
		// Fair Finance must be back before its budgets can be removed.
		wpCli('plugin activate fair-finance', { allowFailure: true });

		const remove = (path) =>
			request.delete(`/wp-json${path}`, { headers: adminHeaders });

		if (created.feeId) {
			await remove(`/fair-audience/v1/fees/${created.feeId}`);
		}
		if (created.groupId) {
			await remove(`/fair-audience/v1/groups/${created.groupId}`);
		}
		for (const id of [created.budgetId, created.otherBudgetId]) {
			if (id) {
				await remove(`/fair-finance/v1/budgets/${id}`);
			}
		}
		Object.assign(created, {
			feeId: 0,
			groupId: 0,
			budgetId: 0,
			otherBudgetId: 0,
		});
	});

	test('creates a fee linked to the chosen budget and keeps the link', async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const feeName = `Budget Flow Fee ${stamp}`;
		const groupName = `Budget Flow Members ${stamp}`;
		const budgetName = `Budget Flow Budget ${stamp}`;

		created.budgetId = (
			await post(request, '/fair-finance/v1/budgets', {
				name: budgetName,
			})
		).id;
		created.groupId = (
			await post(request, '/fair-audience/v1/groups', {
				name: groupName,
			})
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

	test('changes and clears the budget of an existing fee', async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const feeName = `Budget Edit Fee ${stamp}`;
		const budgetName = `Budget Edit First ${stamp}`;
		const otherBudgetName = `Budget Edit Second ${stamp}`;

		created.budgetId = (
			await post(request, '/fair-finance/v1/budgets', {
				name: budgetName,
			})
		).id;
		created.otherBudgetId = (
			await post(request, '/fair-finance/v1/budgets', {
				name: otherBudgetName,
			})
		).id;
		created.groupId = (
			await post(request, '/fair-audience/v1/groups', {
				name: `Budget Edit Members ${stamp}`,
			})
		).id;
		created.feeId = (
			await post(request, '/fair-audience/v1/fees', {
				name: feeName,
				group_id: created.groupId,
				amount: 25,
				budget_id: created.budgetId,
			})
		).id;

		await loginAsAdmin(page);
		await page.goto(FEES_PAGE);
		const row = page.locator('tr', { hasText: feeName });
		await expect(row).toContainText(budgetName);

		// The dialog opens on the budget the fee is saved with.
		let dialog = await openEditDialog(page, feeName);
		let budget = dialog.getByRole('combobox', { name: 'Budget' });
		await expect(
			budget.getByRole('option', { name: otherBudgetName })
		).toBeAttached();
		await expect(budget).toHaveValue(String(created.budgetId));

		// Another budget is still there after a reload.
		await budget.selectOption({ label: otherBudgetName });
		await saveEdit(page, dialog);
		await page.reload();
		await expect(row).toContainText(otherBudgetName);
		expect(Number(await storedBudgetId(request))).toBe(
			created.otherBudgetId
		);

		// So is "No Budget".
		dialog = await openEditDialog(page, feeName);
		budget = dialog.getByRole('combobox', { name: 'Budget' });
		await expect(budget).toHaveValue(String(created.otherBudgetId));
		await budget.selectOption({ label: '-- No Budget --' });
		await saveEdit(page, dialog);
		await page.reload();
		await expect(row).toBeVisible();
		await expect(row).not.toContainText(otherBudgetName);
		expect(await storedBudgetId(request)).toBeNull();

		dialog = await openEditDialog(page, feeName);
		await expect(
			dialog.getByRole('combobox', { name: 'Budget' })
		).toHaveValue('');
	});

	test('leaves budgets out of both dialogs while Fair Finance is inactive', async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const feeName = `Budget Offline Fee ${stamp}`;

		created.budgetId = (
			await post(request, '/fair-finance/v1/budgets', {
				name: `Budget Offline Budget ${stamp}`,
			})
		).id;
		created.groupId = (
			await post(request, '/fair-audience/v1/groups', {
				name: `Budget Offline Members ${stamp}`,
			})
		).id;
		created.feeId = (
			await post(request, '/fair-audience/v1/fees', {
				name: feeName,
				group_id: created.groupId,
				amount: 25,
				budget_id: created.budgetId,
			})
		).id;

		const expectNoBudgetControls = async (dialog) => {
			// The budgets request has been answered once the fields are usable.
			await expect(
				dialog.getByRole('textbox', { name: 'Name' })
			).toBeVisible();
			await expect(dialog.getByText('Loading budgets…')).toBeHidden();
			await expect(
				dialog.getByRole('combobox', { name: 'Budget' })
			).toHaveCount(0);
			await expect(
				dialog.getByText(
					'Budgets are unavailable because Fair Finance is not active.'
				)
			).toHaveCount(0);
			await expect(
				dialog.getByRole('button', { name: 'Retry' })
			).toHaveCount(0);
		};

		// Restored in afterEach, also when an assertion below fails.
		wpCli('plugin deactivate fair-finance');

		await loginAsAdmin(page);
		await page.goto(FEES_PAGE);

		const budgetsAnswered = () =>
			page.waitForResponse((res) =>
				decodeURIComponent(res.url()).includes(
					'fair-finance/v1/budgets'
				)
			);

		let answered = budgetsAnswered();
		await page.getByRole('button', { name: 'Create Fee' }).click();
		expect((await answered).status()).toBe(404);
		const createDialog = page.getByRole('dialog', { name: 'Create Fee' });
		await expectNoBudgetControls(createDialog);
		await createDialog.getByRole('button', { name: 'Cancel' }).click();

		answered = budgetsAnswered();
		const editDialog = await openEditDialog(page, feeName);
		expect((await answered).status()).toBe(404);
		await expectNoBudgetControls(editDialog);

		// Saving other details keeps the budget the fee is linked to.
		await editDialog
			.getByRole('textbox', { name: 'Description' })
			.fill('Edited while Fair Finance was inactive.');
		await saveEdit(page, editDialog);
		expect(Number(await storedBudgetId(request))).toBe(created.budgetId);
	});
});
