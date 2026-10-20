/**
 * Fair Audience Experimental screens are translated (#1872) and stay in
 * English on an English site.
 *
 * Their strings used to sit in Fair Audience's catalog, so the React screens
 * and the public poll page rendered in English on a translated site. The
 * plugin always loads its bundled catalog, so only the locale changes here.
 *
 * Needs a current `npm run makemo` and `npm run build` in
 * fair-audience-experimental.
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin, runScript, wpCli } from './support/wp-cli.js';

const FEES_PAGE = '/wp-admin/admin.php?page=fair-audience-fees';
const COLLABORATORS_PAGE =
	'/wp-admin/admin.php?page=fair-audience-collaborators';
const POLLS_PAGE = '/wp-admin/admin.php?page=fair-audience-polls';
const POLL_RESPONSE_PAGE = '/?poll_key=e2e-unknown-poll-key';

const TEXT = {
	en: {
		fees: 'Membership Fees',
		createFee: 'Create Fee',
		collaborators: 'Collaborators',
		polls: 'Polls',
		invalidPoll: 'Invalid or expired poll link.',
	},
	es: {
		fees: 'Cuotas de membresía',
		createFee: 'Crear tarifa',
		collaborators: 'Colaboradores',
		polls: 'Encuestas',
		invalidPoll: 'Enlace de encuesta no válido o caducado.',
	},
};

const setLocale = (mode) =>
	runScript(
		'translation-delivery.php',
		'E2E_TRANSLATIONS',
		`${mode} es_ES fair-audience-experimental`
	);

async function expectScreens(page, text) {
	await page.goto(FEES_PAGE);
	await expect(
		page.getByRole('heading', { level: 1, name: text.fees })
	).toBeVisible({ timeout: 20_000 });
	await expect(
		page.getByRole('button', { name: text.createFee })
	).toBeVisible();

	await page.goto(COLLABORATORS_PAGE);
	await expect(
		page.getByRole('heading', { level: 1, name: text.collaborators })
	).toBeVisible({ timeout: 20_000 });

	await page.goto(POLLS_PAGE);
	await expect(
		page.getByRole('heading', { level: 1, name: text.polls })
	).toBeVisible({ timeout: 20_000 });

	// Public page, rendered by the poll-response bundle.
	await page.goto(POLL_RESPONSE_PAGE);
	await expect(page.getByText(text.invalidPoll)).toBeVisible({
		timeout: 20_000,
	});
}

test.describe('Fair Audience Experimental translations', () => {
	test.setTimeout(120_000);

	test.beforeAll(() => {
		// Default bundles: every screen above is on.
		wpCli('option delete fair_audience_experimental_features');
		setLocale('reset');
	});
	test.afterAll(() => setLocale('reset'));

	test('Spanish screens from the bundled catalog', async ({ page }) => {
		const result = setLocale('bundled');
		expect(result.plugin).toBe('fair-audience-experimental');

		await loginAsAdmin(page);
		await expectScreens(page, TEXT.es);
	});

	test('English screens on an English site', async ({ page }) => {
		setLocale('reset');

		await loginAsAdmin(page);
		await expectScreens(page, TEXT.en);
	});
});
