/**
 * E2E: Fair Form "Add participants to group" popup (#1935).
 *
 * Driven from the keyboard: the popup lists who is added, blocks every
 * dismissal while requests run, keeps only the failed participant for a
 * retry against the same group, closes with a result notice next to its
 * button and returns focus there. At 375px the popup fits the viewport and
 * its participant list scrolls inside it.
 *
 * The responses, groups and assignment endpoints are answered in the page,
 * so the run needs neither seeded submissions nor the experimental groups
 * plugin.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin } from '../support/wp-cli.js';

const PAGE_URL =
	'/wp-admin/admin.php?page=fair-form-questionnaire-responses&post_id=987654';

function response(id, participantId, name, email) {
	return {
		id,
		participant_id: participantId,
		participant_name: name,
		participant_email: email,
		participant_status: participantId ? 'confirmed' : '',
		participant_mailing: '',
		participant_categories: [],
		created_at: '2026-10-01 10:00:00',
		answers: [
			{
				question_key: 'q1',
				question_text: 'Favourite colour',
				question_type: 'short_text',
				answer_value: `Answer ${id}`,
			},
		],
	};
}

const restPath = (request) => decodeURIComponent(request.url());

/**
 * Answer the page's REST calls. Assignment requests wait for `gate` and
 * fail once for the participants in `failOnce`.
 *
 * @param {import('@playwright/test').Page} page
 * @param {Array}                           responses
 * @param {Object}                          options
 */
async function routeApi(page, responses, { gate, failOnce = [] } = {}) {
	const assigned = [];
	const failed = new Set();
	await page.route(
		(url) =>
			decodeURIComponent(url.href).includes(
				'/fair-form/v1/questionnaire-responses'
			),
		(route) => route.fulfill({ json: responses })
	);
	await page.route(
		(url) =>
			decodeURIComponent(url.href).includes('/fair-audience/v1/groups'),
		async (route) => {
			const request = route.request();
			const path = restPath(request);
			const match = path.match(/groups\/(\d+)\/participants/);
			if (!match) {
				return route.fulfill({
					json: [{ id: 5, name: 'Volunteers', member_count: 2 }],
				});
			}
			if (gate) {
				await gate;
			}
			const { participant_id: pid } = request.postDataJSON();
			if (failOnce.includes(pid) && !failed.has(pid)) {
				failed.add(pid);
				return route.fulfill({
					status: 500,
					json: { code: 'db_error', message: 'Database is busy.' },
				});
			}
			assigned.push(pid);
			return route.fulfill({ json: { message: 'ok' } });
		}
	);
	return assigned;
}

test.describe('Fair Form add participants to group', () => {
	let nativeDialogs;

	test.beforeEach(async ({ page }) => {
		nativeDialogs = [];
		page.on('dialog', async (dialog) => {
			nativeDialogs.push(dialog.message());
			await dialog.dismiss();
		});
		await loginAsAdmin(page);
	});

	test.afterEach(() => {
		expect(nativeDialogs).toEqual([]);
	});

	test('keyboard flow: pending blocks dismissal, retry keeps only the failure, focus returns', async ({
		page,
	}) => {
		let release;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		const assigned = await routeApi(
			page,
			[
				response(1, 11, 'Ana Ruiz', 'ana@example.com'),
				response(2, 12, 'Ben Ito', 'ben@example.com'),
				response(3, 11, 'Ana Ruiz', 'ana@example.com'),
				response(4, 0, '', ''),
			],
			{ gate, failOnce: [12] }
		);

		await page.goto(PAGE_URL);
		const trigger = page.getByRole('button', {
			name: 'Add participants to group',
		});
		await expect(trigger).toBeVisible({ timeout: 15000 });
		await trigger.focus();
		await page.keyboard.press('Enter');

		const dialog = page.getByRole('dialog', {
			name: 'Add participants to group',
		});
		await expect(dialog).toBeVisible();
		await expect(
			dialog.getByText('2 participants will be added:')
		).toBeVisible();
		await expect(
			dialog.getByRole('list', { name: 'Participants to add' })
		).toHaveText(/Ana Ruiz\s*Ben Ito/);
		await expect(
			dialog.getByText(
				'1 response is not linked to a participant and is left out.'
			)
		).toBeVisible();

		const select = dialog.getByRole('combobox', { name: 'Group' });
		await expect(
			select.getByRole('option', { name: 'Volunteers (2)' })
		).toBeAttached();
		await select.focus();
		await select.selectOption('5');
		const submit = dialog.getByRole('button', { name: 'Add to group' });
		await submit.focus();
		await page.keyboard.press('Enter');

		// Pending: every dismissal path is blocked.
		await expect(
			dialog.getByRole('button', { name: 'Adding…' })
		).toBeVisible();
		await expect(
			dialog.getByRole('button', { name: 'Cancel' })
		).toBeDisabled();
		await expect(dialog.getByRole('button', { name: 'Close' })).toHaveCount(
			0
		);
		await page.keyboard.press('Escape');
		await page.mouse.click(5, 5);
		await expect(dialog).toBeVisible();

		release();
		await expect(
			dialog.getByText('1 participant could not be added. Try again:')
		).toBeVisible();
		await expect(
			dialog.getByRole('list', {
				name: 'Participants that could not be added',
			})
		).toHaveText(/Ben Ito\s*Database is busy\./);
		await expect(
			dialog.getByText('Target group: Volunteers')
		).toBeVisible();

		const retry = dialog.getByRole('button', {
			name: 'Try again for 1 participant',
		});
		await retry.focus();
		await page.keyboard.press('Enter');

		await expect(dialog).toBeHidden();
		await expect(
			page.getByText('2 participants were added to the group.', {
				exact: true,
			})
		).toBeVisible();
		await expect(trigger).toBeFocused();
		expect(assigned.sort()).toEqual([11, 12]);
	});

	test('fits a 375px viewport with an internally scrolling list', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 740 });
		const responses = Array.from({ length: 14 }, (_, i) =>
			response(
				i + 1,
				100 + i,
				i === 0
					? 'Maximiliana Wilhelmina Fernández-Castellanos de la Torre'
					: `Participant ${i + 1}`,
				`person${i + 1}@example.com`
			)
		);
		await routeApi(page, responses);

		await page.goto(PAGE_URL);
		await page
			.getByRole('button', { name: 'Add participants to group' })
			.click({ timeout: 15000 });
		const dialog = page.getByRole('dialog');
		await expect(dialog).toBeVisible();

		const box = await dialog.boundingBox();
		expect(box.x).toBeGreaterThanOrEqual(0);
		expect(box.x + box.width).toBeLessThanOrEqual(375);
		const overflow = await page.evaluate(
			() => document.documentElement.scrollWidth
		);
		expect(overflow).toBeLessThanOrEqual(375);

		const list = dialog.getByRole('list', {
			name: 'Participants to add',
		});
		const scrolls = await list.evaluate(
			(el) => el.scrollHeight > el.clientHeight
		);
		expect(scrolls).toBe(true);
		await list.focus();
		await expect(list).toBeFocused();
	});
});
