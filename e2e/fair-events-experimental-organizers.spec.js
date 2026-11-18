/**
 * Managing multiple organizers in Fair Events Experimental (#2304).
 *
 * Covers the `organizers` bundle staying off until enabled, its dedicated
 * Organizers page (menu position, Settings without an Organizer tab, the
 * legacy tab URL redirecting there), creating two organizers with
 * independent private recipients, editing the sitewide default in its
 * existing option, and turning the bundle off (single Organizer tab back)
 * and on again with every organizer kept.
 *
 * Run: `npm run test:e2e:local -- e2e/fair-events-experimental-organizers.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';
import { setExperimentalFeature } from './support/experimental-features.js';

const PAGE_URL = '/wp-admin/admin.php?page=fair-events-organizers';
const TAB_URL = '/wp-admin/admin.php?page=fair-events-settings&tab=organizer';
const EXPERIMENTAL_TAB_URL =
	'/wp-admin/admin.php?page=fair-events-settings&tab=experimental';
const INDEX_OPTION = 'fair_events_experimental_organizer_ids';
const OPTION_PREFIX = 'fair_events_experimental_organizer_';

function optionJson(name) {
	const out = wpCli(`option get ${name} --format=json`, {
		allowFailure: true,
	}).trim();
	return out ? JSON.parse(out) : null;
}

function removeOrganizers() {
	for (const id of optionJson(INDEX_OPTION) || []) {
		wpCli(`option delete ${OPTION_PREFIX}${id}`, {
			allowFailure: true,
		});
	}
	wpCli(`option delete ${INDEX_OPTION}`, { allowFailure: true });
	wpCli('option delete fair_events_organizer', { allowFailure: true });
}

async function addOrganizer(page, name, email) {
	await page.getByRole('button', { name: 'Add organizer' }).click();
	await page.getByLabel('Name (required)').fill(name);
	await page.getByRole('button', { name: 'Add email address' }).click();
	await page.getByLabel('Notification email address').fill(email);
	await page.getByRole('button', { name: 'Save organizer' }).click();
	await expect(
		page
			.locator('.components-notice__content')
			.getByText('Organizer added.')
	).toBeVisible();
	await page.getByRole('button', { name: '← All organizers' }).click();
}

const row = (page, name) =>
	page.getByRole('row').filter({ hasText: name }).first();

/** Labels of the Fair Events submenu, in order. */
async function eventsSubmenu(page) {
	return page
		.locator('#toplevel_page_fair-events-calendar .wp-submenu a')
		.allTextContents();
}

test.describe('Organizers bundle default', () => {
	test.beforeEach(() => {
		setExperimentalFeature('organizers', undefined);
		removeOrganizers();
	});

	test.afterAll(() => {
		setExperimentalFeature('organizers', undefined);
		removeOrganizers();
	});

	test('stays off with the plugin active and keeps the single Organizer tab', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(TAB_URL);

		await expect(page).toHaveURL(/page=fair-events-settings&tab=organizer/);
		await expect(
			page.getByRole('tab', {
				name: 'Organizer',
				exact: true,
				selected: true,
			})
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Save organizer' })
		).toBeVisible();
		expect(await eventsSubmenu(page)).not.toContain('Organizers');

		const response = await page.goto(PAGE_URL);
		expect(response.status()).toBe(403);
	});

	test('enabling it in the Experimental tab adds the Organizers page', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(EXPERIMENTAL_TAB_URL);

		const toggle = page.getByRole('checkbox', {
			name: 'Organizers',
			exact: true,
		});
		await expect(toggle).not.toBeChecked();
		await toggle.check();
		await page.getByRole('button', { name: 'Save Features' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText(/Features saved/)
		).toBeVisible();

		await page.reload();
		const submenu = await eventsSubmenu(page);
		const settings = submenu.indexOf('Settings');
		expect(settings).toBe(submenu.length - 1);
		expect(submenu[settings - 1]).toBe('Organizers');
		await expect(
			page.getByRole('tab', { name: /^Organizers?$/ })
		).toHaveCount(0);

		await page.goto(PAGE_URL);
		await expect(
			page.getByRole('heading', { level: 1, name: 'Organizers' })
		).toBeVisible();
		await expect(
			row(page, 'Default — used for the whole site')
		).toBeVisible();
	});
});

test.describe('Organizers manager', () => {
	test.beforeEach(() => {
		setExperimentalFeature('organizers', true);
		removeOrganizers();
	});

	test.afterAll(() => {
		setExperimentalFeature('organizers', undefined);
		removeOrganizers();
	});

	test('the former Organizer tab URL opens the Organizers page', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(PAGE_URL);

		await expect(page).toHaveURL(/page=fair-events-organizers$/);
		await expect(
			page.getByRole('heading', { level: 1, name: 'Organizers' })
		).toBeVisible();
	});

	test('two organizers keep their own notification addresses', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(PAGE_URL);

		await expect(
			row(page, 'Default — used for the whole site')
		).toBeVisible();

		await addOrganizer(page, 'North Club', 'north@example.com');
		await addOrganizer(page, 'South Club', 'south@example.com');

		await page.reload();
		await expect(row(page, 'North Club')).toContainText('1 address');
		await expect(row(page, 'South Club')).toContainText('1 address');

		await page.getByRole('button', { name: 'Edit “North Club”' }).click();
		await expect(page.getByLabel('Name (required)')).toHaveValue(
			'North Club'
		);
		await expect(page.getByLabel('Notification email address')).toHaveValue(
			'north@example.com'
		);
		await expect(page.getByLabel('Website')).toHaveValue('');
		await page.getByRole('button', { name: '← All organizers' }).click();

		await page.getByRole('button', { name: 'Edit “South Club”' }).click();
		await expect(page.getByLabel('Notification email address')).toHaveValue(
			'south@example.com'
		);
	});

	test('organizer types persist for additional and default organizers', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(PAGE_URL);

		await page.getByRole('button', { name: 'Add organizer' }).click();
		await expect(page.getByLabel('Organizer type')).toHaveValue(
			'Organization'
		);
		await page.getByLabel('Name (required)').fill('Ana García');
		await page.getByLabel('Organizer type').selectOption('Person');
		await page.getByRole('button', { name: 'Save organizer' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Organizer added.')
		).toBeVisible();

		await page.reload();
		await page.getByRole('button', { name: 'Edit “Ana García”' }).click();
		await expect(page.getByLabel('Organizer type')).toHaveValue('Person');
		await page.getByLabel('Organizer type').selectOption('NGO');
		await page.getByRole('button', { name: 'Save organizer' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Organizer saved.')
		).toBeVisible();
		const [id] = optionJson(INDEX_OPTION);
		expect(optionJson(OPTION_PREFIX + id)).toMatchObject({
			type: 'NGO',
		});

		await page.getByRole('button', { name: '← All organizers' }).click();
		await row(page, 'Default — used for the whole site')
			.getByRole('button', { name: /^Edit/ })
			.click();
		await page.getByLabel('Organizer type').selectOption('Corporation');
		await page.getByRole('button', { name: 'Save organizer' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Organizer saved.')
		).toBeVisible();
		expect(optionJson('fair_events_organizer')).toMatchObject({
			type: 'Corporation',
		});

		await page.reload();
		await row(page, 'Default — used for the whole site')
			.getByRole('button', { name: /^Edit/ })
			.click();
		await expect(page.getByLabel('Organizer type')).toHaveValue(
			'Corporation'
		);
	});

	test('editing the default writes the sitewide organizer', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(PAGE_URL);

		await row(page, 'Default — used for the whole site')
			.getByRole('button', { name: /^Edit/ })
			.click();
		await expect(
			page.getByRole('heading', { name: 'Edit default organizer' })
		).toBeVisible();

		await page.getByLabel('Name', { exact: true }).fill('Sitewide Org');
		await page.getByRole('button', { name: 'Add email address' }).click();
		await page
			.getByLabel('Notification email address')
			.fill('board@example.com');
		await page.getByRole('button', { name: 'Save organizer' }).click();
		await expect(
			page
				.locator('.components-notice__content')
				.getByText('Organizer saved.')
		).toBeVisible();

		expect(optionJson('fair_events_organizer')).toMatchObject({
			name: 'Sitewide Org',
			notification_emails: ['board@example.com'],
		});
	});

	test('turning the bundle off restores the single tab and keeps every organizer', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await page.goto(PAGE_URL);
		await addOrganizer(page, 'Kept Club', 'kept@example.com');

		setExperimentalFeature('organizers', false);
		await page.goto(TAB_URL);
		await expect(page).toHaveURL(/page=fair-events-settings&tab=organizer/);
		expect(await eventsSubmenu(page)).not.toContain('Organizers');
		await expect(
			page.getByRole('tab', {
				name: 'Organizer',
				exact: true,
				selected: true,
			})
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Save organizer' })
		).toBeVisible();
		await expect(
			page.getByRole('button', { name: 'Add organizer' })
		).toHaveCount(0);

		setExperimentalFeature('organizers', true);
		await page.goto(PAGE_URL);
		await expect(row(page, 'Kept Club')).toContainText('1 address');
	});
});
