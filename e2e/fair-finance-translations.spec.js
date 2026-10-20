/**
 * Fair Finance admin screens are translated (#1872), whichever way the
 * translations reach the site — a WordPress.org language pack in
 * wp-content/languages/plugins/ or the opt-in bundled catalog — and stay in
 * English on an English site.
 *
 * The budgets screen's strings used to sit in Fair Payments Connector's
 * catalog, so they rendered in English on a translated site.
 *
 * The `translation-delivery.php` fixture sets the site locale and copies the
 * plugin's own es_ES catalog to the language-pack location, so the spec
 * needs a current `npm run makemo` and `npm run build` in fair-finance.
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript } from './support/wp-cli.js';

const BUDGETS_PAGE = '/wp-admin/admin.php?page=fair-finance-budgets';
const ENTRIES_PAGE = '/wp-admin/admin.php?page=fair-finance-entries';
const RECONCILIATION_PAGE =
	'/wp-admin/admin.php?page=fair-finance-reconciliation';

const TEXT = {
	en: {
		menu: 'Budgets',
		budgets: 'Budget Categories',
		addBudget: 'Add New Budget',
		entries: 'Financial Entries',
		reconciliation: 'Reconciliation',
	},
	es: {
		menu: 'Presupuestos',
		budgets: 'Categorías de presupuesto',
		addBudget: 'Agregar nuevo presupuesto',
		entries: 'Entradas financieras',
		reconciliation: 'Conciliación',
	},
};

const setDelivery = (mode, locale = 'es_ES') =>
	runScript(
		'translation-delivery.php',
		'E2E_TRANSLATIONS',
		`${mode} ${locale} fair-finance`
	);

async function expectScreens(page, text) {
	await page.goto(BUDGETS_PAGE);
	// Rendered by PHP: the admin menu.
	await expect(
		page.locator('#toplevel_page_fair-finance-entries .wp-submenu a', {
			hasText: new RegExp(`^${text.menu}$`),
		})
	).toBeVisible();
	// Rendered by the React bundles.
	await expect(
		page.getByRole('heading', { level: 1, name: text.budgets })
	).toBeVisible({ timeout: 20_000 });
	await expect(
		page.getByRole('button', { name: text.addBudget })
	).toBeVisible();

	await page.goto(ENTRIES_PAGE);
	await expect(
		page.getByRole('heading', { level: 1, name: text.entries })
	).toBeVisible({ timeout: 20_000 });

	await page.goto(RECONCILIATION_PAGE);
	await expect(
		page.getByRole('heading', { level: 1, name: text.reconciliation })
	).toBeVisible({ timeout: 20_000 });
}

test.describe('Fair Finance translations', () => {
	test.setTimeout(120_000);

	test.beforeAll(() => setDelivery('reset'));
	test.afterAll(() => setDelivery('reset'));

	for (const mode of ['language-pack', 'bundled']) {
		test(`Spanish screens from the ${mode} catalog`, async ({ page }) => {
			const result = setDelivery(mode);
			expect(result.plugin).toBe('fair-finance');

			await loginAsAdmin(page);
			await expectScreens(page, TEXT.es);
		});
	}

	test('English screens on an English site', async ({ page }) => {
		setDelivery('reset');

		await loginAsAdmin(page);
		await expectScreens(page, TEXT.en);
	});
});
