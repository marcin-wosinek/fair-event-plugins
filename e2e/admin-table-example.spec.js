/**
 * Shared admin table pattern (#2205), exercised on the test-only example page
 * served by e2e/mu-plugins/fair-e2e-admin-table-example.php. Covers what
 * jsdom cannot: the real responsive layout, the WordPress menu's keyboard
 * focus handling and focus restoration around a consumer dialog.
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './support/wp-cli.js';

const PAGE = '/wp-admin/admin.php?page=fair-e2e-admin-table-example';
const LONG_NAME = /^Spring Community Dance Workshop/;
const MORE_SPRING = /^More actions for “Spring Community Dance Workshop/;

test.describe('admin table example', () => {
	test.beforeEach(async ({ page }) => {
		await loginAsAdmin(page);
	});

	test('desktop: columns, amounts, statuses and the action column', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 1280, height: 900 });
		await page.goto(PAGE);

		const table = page.getByRole('table', { name: 'Example entries' });
		await expect(table).toBeVisible();
		await expect(table.locator('thead')).toBeVisible();
		await expect(
			table.getByRole('columnheader', { name: 'Actions' })
		).toBeVisible();

		const amount = table.getByRole('cell', { name: '€1,250.00' });
		await expect(amount).toHaveCSS('text-align', 'right');
		await expect(table.getByText('Paid', { exact: true })).toBeVisible();
		await expect(
			table.getByRole('link', { name: LONG_NAME })
		).toBeVisible();

		// A row without secondary actions has no overflow trigger.
		await expect(
			table.getByRole('button', {
				name: /More actions for “Morning yoga”/,
			})
		).toHaveCount(0);

		// A disabled action stays focusable and says why.
		const sendTest = table.getByRole('button', { name: 'Send test' });
		await expect(sendTest).toHaveAttribute('aria-disabled', 'true');
		await expect(sendTest).toHaveAccessibleDescription(
			'Add a recipient before sending a test.'
		);

		// The page never scrolls sideways.
		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	test('mobile: stacked labeled rows keep identity, amount, status and actions', async ({
		page,
	}) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await page.goto(PAGE);

		const table = page.getByRole('table', { name: 'Example entries' });
		await expect(
			table.getByRole('link', { name: LONG_NAME })
		).toBeVisible();
		await expect(table.locator('thead')).toBeHidden();

		const amount = table.getByRole('cell', { name: '€1,250.00' });
		await expect(amount).toHaveAttribute('data-label', 'Amount');
		const label = await amount.evaluate(
			(cell) => getComputedStyle(cell, '::before').content
		);
		expect(label).toBe('"Amount"');

		await expect(
			table.getByRole('button', { name: MORE_SPRING })
		).toBeVisible();

		const overflow = await page.evaluate(
			() =>
				document.documentElement.scrollWidth -
				document.documentElement.clientWidth
		);
		expect(overflow).toBeLessThanOrEqual(0);
	});

	test('keyboard: open the menu, move with arrows, Escape returns focus', async ({
		page,
	}) => {
		await page.goto(PAGE);
		const toggle = page.getByRole('button', { name: MORE_SPRING });

		await toggle.focus();
		await page.keyboard.press('Enter');
		const menu = page.getByRole('menu', { name: MORE_SPRING });
		await expect(menu).toBeVisible();
		await expect(toggle).toHaveAttribute('aria-expanded', 'true');

		await expect(
			menu.getByRole('menuitem', { name: 'Duplicate' })
		).toBeFocused();
		await page.keyboard.press('ArrowDown');
		await expect(
			menu.getByRole('menuitem', { name: 'Export CSV' })
		).toBeFocused();

		await page.keyboard.press('Escape');
		await expect(menu).toBeHidden();
		await expect(toggle).toBeFocused();
	});

	test('focus returns to the trigger after cancelling a dialog and moves to the heading after deleting', async ({
		page,
	}) => {
		await page.goto(PAGE);
		const toggle = page.getByRole('button', { name: MORE_SPRING });

		await toggle.click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		const dialog = page.getByRole('dialog', { name: /^Delete entry — / });
		await expect(dialog).toBeVisible();
		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toBeHidden();
		await expect(toggle).toBeFocused();

		await toggle.click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await dialog.getByRole('button', { name: 'Delete entry' }).click();
		await expect(dialog).toBeHidden();
		await expect(
			page.getByRole('heading', { name: 'Admin table example' })
		).toBeFocused();
		await expect(page.getByRole('link', { name: LONG_NAME })).toHaveCount(
			0
		);
		await expect(page.getByText('4 of 4 entries')).toBeVisible();
	});

	test('pending, error with retry, empty and no-results states', async ({
		page,
	}) => {
		await page.goto(`${PAGE}&scenario=pending`);
		await expect(
			page.getByRole('button', { name: 'Retrying…' })
		).toHaveAttribute('aria-disabled', 'true');

		await page.goto(`${PAGE}&scenario=error`);
		const error = page.locator('.components-notice.is-error');
		await expect(error).toContainText('could not be refreshed');
		// The stale rows stay visible as context.
		await expect(
			page.getByRole('table', { name: 'Example entries' })
		).toBeVisible();
		await error.getByRole('button', { name: 'Try again' }).click();
		await expect(error).toBeHidden();
		await expect(
			page.getByRole('table', { name: 'Example entries' })
		).toBeVisible();

		await page.goto(`${PAGE}&scenario=empty`);
		await expect(page.getByText(/^No entries yet\./)).toBeVisible();

		await page.goto(`${PAGE}&scenario=no-results`);
		await expect(page.getByText('No entries match “zzz”.')).toBeVisible();
		await page.getByRole('button', { name: 'Clear search' }).click();
		await expect(
			page.getByRole('table', { name: 'Example entries' })
		).toBeVisible();
	});
});
