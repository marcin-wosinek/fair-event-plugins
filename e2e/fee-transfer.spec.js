/**
 * E2E: an administrator settles a pending membership fee payment with a
 * transfer between budgets (#1802).
 *
 * On Fee Detail the administrator opens a member's row menu, picks "Create
 * Transfer", chooses the source budget — the fee's own budget is already the
 * target — and confirms. The page reports the transfer, the payment is paid,
 * and the transfer exists in Fair Finance between those two budgets.
 *
 * The budgets, group, member and fee are created through the admin REST API;
 * they and the transfer are removed afterwards.
 */
import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USER, loginAsAdmin } from './support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('Settle a membership fee payment with a transfer', () => {
	const created = {
		entryId: 0,
		feeId: 0,
		participantId: 0,
		groupId: 0,
		budgetIds: [],
	};

	test.afterEach(async ({ request }) => {
		const remove = (path) =>
			request.delete(`/wp-json${path}`, { headers: adminHeaders });

		if (created.entryId) {
			await remove(
				`/fair-finance/v1/financial-entries/${created.entryId}`
			);
		}
		if (created.feeId) {
			await remove(`/fair-audience/v1/fees/${created.feeId}`);
		}
		if (created.participantId) {
			await remove(
				`/fair-audience/v1/participants/${created.participantId}`
			);
		}
		if (created.groupId) {
			await remove(`/fair-audience/v1/groups/${created.groupId}`);
		}
		for (const id of created.budgetIds) {
			await remove(`/fair-finance/v1/budgets/${id}`);
		}
	});

	test('creates the transfer from the row menu and marks the payment paid', async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const feeName = `Transfer Flow Fee ${stamp}`;
		const sourceName = `Transfer Flow Bank ${stamp}`;
		const targetName = `Transfer Flow Income ${stamp}`;
		const member = {
			name: 'Tessa',
			surname: `Transferred${stamp}`,
			email: `fee-transfer-${stamp}@example.test`,
		};

		const post = async (path, data) => {
			const res = await request.post(`/wp-json${path}`, {
				headers: adminHeaders,
				data,
			});
			expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
			return res.json();
		};
		const get = async (path) => {
			const res = await request.get(`/wp-json${path}`, {
				headers: adminHeaders,
			});
			expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
			return res.json();
		};

		const sourceId = (
			await post('/fair-finance/v1/budgets', { name: sourceName })
		).id;
		created.budgetIds.push(sourceId);
		const targetId = (
			await post('/fair-finance/v1/budgets', { name: targetName })
		).id;
		created.budgetIds.push(targetId);

		created.groupId = (
			await post('/fair-audience/v1/groups', {
				name: `Transfer Flow Members ${stamp}`,
			})
		).id;
		created.participantId = (
			await post('/fair-audience/v1/participants', {
				...member,
				email_profile: 'minimal',
			})
		).id;
		await post(`/fair-audience/v1/groups/${created.groupId}/participants`, {
			participant_id: created.participantId,
		});
		created.feeId = (
			await post('/fair-audience/v1/fees', {
				name: feeName,
				group_id: created.groupId,
				amount: 25,
				budget_id: targetId,
			})
		).id;

		await loginAsAdmin(page);
		await page.goto(
			`/wp-admin/admin.php?page=fair-audience-fee-detail&fee_id=${created.feeId}`
		);

		const row = page.locator('tr', { hasText: member.surname });
		await expect(row).toBeVisible();
		await row.getByRole('button', { name: 'Actions' }).click();
		await page.getByRole('menuitem', { name: 'Create Transfer' }).click();

		// The fee's budget is the target; the administrator picks the source.
		const dialog = page.getByRole('dialog', { name: 'Create Transfer' });
		await expect(dialog).toContainText(`Tessa ${member.surname}`);
		const source = dialog.getByRole('combobox', {
			name: 'From Budget (Source)',
		});
		const target = dialog.getByRole('combobox', {
			name: 'To Budget (Target)',
		});
		await expect(
			source.getByRole('option', { name: sourceName })
		).toBeAttached();
		await expect(target).toHaveValue(String(targetId));
		await source.selectOption({ label: sourceName });

		const transferred = page.waitForResponse(
			(res) =>
				res.request().method() === 'POST' &&
				decodeURIComponent(res.url()).includes(
					'/fair-finance/v1/financial-entries/transfer'
				)
		);
		await dialog.getByRole('button', { name: 'Create Transfer' }).click();
		const response = await transferred;
		expect(response.status(), await response.text()).toBe(201);
		const transfer = await response.json();
		created.entryId = transfer.id;

		await expect(
			page.locator('.components-notice__content', {
				hasText: 'Transfer created and payment marked as paid.',
			})
		).toBeVisible();
		await expect(dialog).toBeHidden();

		// The payment is paid, and stays so after a reload.
		const payments = await get(
			`/fair-audience/v1/fees/${created.feeId}/payments`
		);
		expect(payments).toHaveLength(1);
		expect(payments[0].status).toBe('paid');
		await page.reload();
		await expect(row).toContainText(/paid/i);

		// The transfer exists in Fair Finance, between the two budgets.
		const entry = await get(
			`/fair-finance/v1/financial-entries/${created.entryId}`
		);
		expect(entry.entry_type).toBe('transfer');
		expect(Number(entry.amount)).toBe(25);
		expect(entry.description).toContain(feeName);
		expect(Number(entry.participant_id)).toBe(created.participantId);

		const side = (type) =>
			transfer.children.find((child) => child.entry_type === type);
		expect(Number(side('cost').budget_id)).toBe(sourceId);
		expect(Number(side('income').budget_id)).toBe(targetId);
	});
});
