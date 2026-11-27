/**
 * E2E: per-feed WhatsApp sharing reminders (#2136).
 *
 * From Event notifications, an administrator opens WhatsApp sharing
 * reminders, designates a collaborator for an event feed with their
 * consent, chooses the approved template whose button opens the feed's
 * weekly summary, saves, reloads, changes the number (which asks for
 * consent again) and removes the collaborator after a confirmation. The
 * same form is also driven at a phone-sized viewport.
 *
 * The WhatsApp connection is stored as validated through WP-CLI;
 * lib/whatsapp-http-double.php answers the template list, with the feed's
 * template stored in its `fair_e2e_whatsapp_extra_templates` option.
 * Nothing is sent: no scheduled run happens during the spec.
 *
 * Run: `npm run test:e2e:local -- e2e/user-flows/whatsapp-sharing-reminders.spec.js`.
 */

import { test, expect } from '../support/fixtures.js';
import { wpCli, loginAsAdmin, runScript } from '../support/wp-cli.js';
import { setExperimentalFeature } from '../support/experimental-features.js';

const NOTIFICATIONS_URL =
	'/wp-admin/admin.php?page=fair-events-event-notifications';
const FIXTURE = 'whatsapp-reminders-fixture.php';
const MARKER = 'E2E_REMINDERS';

const OPTIONS = [
	'fair_events_experimental_whatsapp_access_token',
	'fair_events_experimental_whatsapp_waba_id',
	'fair_events_experimental_whatsapp_phone_number_id',
	'fair_events_experimental_whatsapp_validation',
	'fair_e2e_whatsapp_extra_templates',
	'fair_e2e_whatsapp_requests',
];

let previousFeature;
let feed;
const created = { termIds: [], pageIds: [], sourceIds: [], eventIds: [] };

function templateFor(name, url) {
	return {
		name,
		language: 'es_ES',
		status: 'APPROVED',
		category: 'UTILITY',
		components: [
			{ type: 'BODY', text: 'Comparte el resumen semanal.' },
			{
				type: 'BUTTONS',
				buttons: [{ type: 'URL', text: 'Abrir', url }],
			},
		],
	};
}

/** Sends the double received. */
function sendCount() {
	const out = wpCli('option get fair_e2e_whatsapp_requests --format=json', {
		allowFailure: true,
	}).trim();
	const start = out.indexOf('[');
	const log = start < 0 ? [] : JSON.parse(out.slice(start));
	return log.filter((entry) => 'POST' === entry.method).length;
}

async function openReminders(page) {
	await page.goto(NOTIFICATIONS_URL);
	const entry = page.getByRole('link', {
		name: 'Manage WhatsApp sharing reminders',
	});
	await expect(entry).toBeVisible();
	await page.goto(await entry.getAttribute('href'));
	await expect(
		page.getByRole('heading', { name: 'WhatsApp sharing reminders' })
	).toBeVisible();
}

async function openEditor(page) {
	await page
		.getByRole('button', {
			name: `Edit the reminder for ${feed.name}`,
		})
		.click();
	await expect(
		page.getByRole('heading', { name: `Reminder for ${feed.name}` })
	).toBeVisible();
}

test.describe('WhatsApp sharing reminders', () => {
	test.describe.configure({ mode: 'serial' });

	test.beforeAll(() => {
		previousFeature = setExperimentalFeature('whatsapp', true);
		const made = runScript(FIXTURE, MARKER, 'feed browser');
		created.termIds.push(made.termId);
		created.pageIds.push(made.pageId);
		created.sourceIds.push(made.sourceId);
		feed = made;
		wpCli(
			`option update fair_e2e_whatsapp_extra_templates '${JSON.stringify([
				templateFor('browser_summary', made.summaryUrl),
			])}' --format=json`
		);
		wpCli(
			`eval 'update_option( "fair_events_experimental_whatsapp_access_token", "e2e-whatsapp-reminders-browser-0123456789", false ); \\FairEventsExperimental\\WhatsApp\\Configuration::save( "100000000000001", "200000000000002" ); \\FairEventsExperimental\\WhatsApp\\Configuration::record_validation( array( "display_phone_number" => "+34 600 000 002", "verified_name" => "Fair Events E2E", "quality_rating" => "GREEN" ) );'`
		);
		wpCli('option delete fair_e2e_whatsapp_requests', {
			allowFailure: true,
		});
	});

	test.afterAll(() => {
		runScript(FIXTURE, MARKER, `cleanup '${JSON.stringify(created)}'`);
		wpCli(`option delete ${OPTIONS.join(' ')}`, {
			allowFailure: true,
		});
		setExperimentalFeature('whatsapp', previousFeature);
	});

	test('an administrator designates, changes and removes a collaborator', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await openReminders(page);
		const row = page.getByRole('row', { name: new RegExp(feed.name) });
		await expect(row.getByText('Not set up')).toBeVisible();

		await openEditor(page);
		await page.getByLabel('Send the weekly reminder').check();
		await page.getByLabel('Someone else').check();
		await page.getByLabel('Name', { exact: true }).fill('Ana Demo');
		await page.getByLabel('WhatsApp number').fill('+34 600 000 501');
		await page.getByLabel('Template').selectOption('browser_summary|es_ES');
		await page.getByLabel('Send on').selectOption('3');
		await page.getByLabel('Send at').fill('09:30');

		const save = page.getByRole('button', { name: 'Save reminder' });
		await expect(save).toBeDisabled();
		await page
			.getByLabel(
				'Ana Demo agreed to receive these weekly WhatsApp reminders at +34 600 000 501.'
			)
			.check();
		await save.click();
		await expect(
			page.locator('.components-notice__content', {
				hasText: 'Reminder saved.',
			})
		).toBeVisible();

		// The saved reminder survives a reload.
		await page.reload();
		await expect(row.getByText('On', { exact: true })).toBeVisible();
		await expect(row.getByText('Ana Demo')).toBeVisible();
		await openEditor(page);
		await expect(page.getByLabel('WhatsApp number')).toHaveValue(
			'+34600000501'
		);
		await expect(page.getByLabel('Template')).toHaveValue(
			'browser_summary|es_ES'
		);
		await expect(page.getByLabel('Send on')).toHaveValue('3');

		// Another number needs consent again.
		await page.getByLabel('WhatsApp number').fill('+34 600 000 502');
		await expect(page.getByText('Unsaved changes').first()).toBeVisible();
		const consent = page.getByLabel(
			'Ana Demo agreed to receive these weekly WhatsApp reminders at +34 600 000 502.'
		);
		await expect(consent).not.toBeChecked();
		await expect(save).toBeDisabled();
		await consent.check();
		await save.click();
		await expect(
			page.locator('.components-notice__content', {
				hasText: 'Reminder saved.',
			})
		).toBeVisible();

		// Removing the collaborator is confirmed and keeps the rest.
		await page.getByRole('button', { name: 'Remove collaborator' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText('Ana Demo will no longer get');
		await dialog
			.getByRole('button', { name: 'Remove collaborator' })
			.click();
		await expect(dialog).toBeHidden();
		await expect(row.getByText('Nobody yet')).toBeVisible();
		await expect(
			row.getByText('No collaborator is designated.')
		).toBeVisible();

		expect(sendCount()).toBe(0);
	});

	test('the form works on a phone-sized screen', async ({ page }) => {
		await page.setViewportSize({ width: 375, height: 812 });
		await loginAsAdmin(page);
		await openReminders(page);
		await openEditor(page);

		await page.getByLabel('Someone else').check();
		await page.getByLabel('Name', { exact: true }).fill('Bea Demo');
		await page.getByLabel('WhatsApp number').fill('+34 600 000 503');
		await page
			.getByLabel(
				'Bea Demo agreed to receive these weekly WhatsApp reminders at +34 600 000 503.'
			)
			.check();
		const save = page.getByRole('button', { name: 'Save reminder' });
		await save.scrollIntoViewIfNeeded();
		await save.click();
		await expect(
			page.locator('.components-notice__content', {
				hasText: 'Reminder saved.',
			})
		).toBeVisible();
		// Nothing overflows the viewport sideways.
		expect(
			await page.evaluate(
				() => document.documentElement.scrollWidth <= window.innerWidth
			)
		).toBe(true);
	});
});
