/**
 * E2E: an organizer reminds one member about a pending membership fee from
 * that member's row on Fee Detail (#1770).
 *
 * Two members owe the same fee. The organizer opens the first member's row
 * menu, picks "Send Payment Reminder", checks the dialog names that member,
 * their address and the fee, and confirms. The page reports the send, the
 * row shows a reminder date, the payment's audit log lists the reminder, and
 * exactly one email left — to that member. The second member's row is
 * unchanged and they received nothing.
 *
 * The group, members and fee are created through the admin REST API and
 * removed afterwards. Mail is captured by fair-e2e-support.php and read back
 * through fair-e2e-fee-reminders.php.
 */

import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USER, loginAsAdmin } from '../support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

test.describe('Remind one member about a pending membership fee', () => {
	const created = { feeId: 0, groupId: 0, participantIds: [] };

	test.afterEach(async ({ request }) => {
		const remove = (path) =>
			request.delete(`/wp-json${path}`, { headers: adminHeaders });

		if (created.feeId) {
			await remove(`/fair-audience/v1/fees/${created.feeId}`);
		}
		for (const id of created.participantIds) {
			await remove(`/fair-audience/v1/participants/${id}`);
		}
		if (created.groupId) {
			await remove(`/fair-audience/v1/groups/${created.groupId}`);
		}
		await remove('/fair-e2e/v1/fee-reminders/mail');
	});

	test('sends the reminder from the row menu and records it', async ({
		page,
		request,
	}) => {
		const stamp = Date.now();
		const feeName = `Reminder Flow Fee ${stamp}`;
		const target = {
			name: 'Rita',
			surname: `Reminded${stamp}`,
			email: `fee-reminded-${stamp}@example.test`,
		};
		const bystander = {
			name: 'Bruno',
			surname: `Bystander${stamp}`,
			email: `fee-bystander-${stamp}@example.test`,
		};

		const post = async (path, data) => {
			const res = await request.post(`/wp-json${path}`, {
				headers: adminHeaders,
				data,
			});
			expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
			return res.json();
		};
		const capturedMail = async (email) => {
			const res = await request.get(
				'/wp-json/fair-e2e/v1/fee-reminders/mail',
				{ headers: adminHeaders, params: email ? { to: email } : {} }
			);
			expect(res.ok()).toBeTruthy();
			return res.json();
		};

		created.groupId = (
			await post('/fair-audience/v1/groups', {
				name: `Reminder Flow Members ${stamp}`,
			})
		).id;
		for (const member of [target, bystander]) {
			const participant = await post('/fair-audience/v1/participants', {
				...member,
				email_profile: 'minimal',
			});
			created.participantIds.push(participant.id);
			await post(
				`/fair-audience/v1/groups/${created.groupId}/participants`,
				{ participant_id: participant.id }
			);
		}
		created.feeId = (
			await post('/fair-audience/v1/fees', {
				name: feeName,
				group_id: created.groupId,
				amount: 25,
			})
		).id;
		await request.delete('/wp-json/fair-e2e/v1/fee-reminders/mail', {
			headers: adminHeaders,
		});

		await loginAsAdmin(page);
		await page.goto(
			`/wp-admin/admin.php?page=fair-audience-fee-detail&fee_id=${created.feeId}`
		);

		const row = (member) => page.locator('tr', { hasText: member.surname });
		const sentDate = /\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/;
		await expect(row(target)).toBeVisible();
		await expect(row(target)).not.toContainText(sentDate);

		// The row menu offers the reminder for a pending payment.
		await row(target).getByRole('button', { name: 'Actions' }).click();
		await page
			.getByRole('menuitem', { name: 'Send Payment Reminder' })
			.click();

		// The dialog says who is about to be written to, and about what.
		const dialog = page.getByRole('dialog', {
			name: 'Send Payment Reminder',
		});
		await expect(dialog).toContainText(`${target.name} ${target.surname}`);
		await expect(dialog).toContainText(target.email);
		await expect(dialog).toContainText(feeName);
		expect(await capturedMail()).toHaveLength(0);

		await dialog
			.getByRole('button', { name: 'Send Payment Reminder' })
			.click();

		// The page reports the send and the row picks up its reminder date.
		await expect(
			page.locator('.components-notice__content', {
				hasText: `Payment reminder sent to ${target.email}.`,
			})
		).toBeVisible();
		await expect(dialog).toBeHidden();
		await expect(row(target)).toContainText(sentDate);
		await expect(row(bystander)).not.toContainText(sentDate);

		// One email left, addressed to that member only.
		const mail = await capturedMail();
		expect(mail).toHaveLength(1);
		expect(mail[0].to).toEqual([target.email]);
		expect(mail[0].subject).toContain(feeName);
		expect(await capturedMail(bystander.email)).toHaveLength(0);

		// The payment's audit log lists the reminder and who sent it.
		await row(target).getByRole('button', { name: 'Actions' }).click();
		await page.getByRole('menuitem', { name: 'View Audit Log' }).click();
		const auditLog = page.getByRole('dialog', { name: 'Audit Log' });
		await expect(auditLog).toContainText('reminder sent');
		await expect(auditLog).toContainText(`By: ${ADMIN_USER}`);
	});
});
