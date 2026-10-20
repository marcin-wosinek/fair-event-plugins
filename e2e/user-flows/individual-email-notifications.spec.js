/**
 * E2E: individual email event notifications on a standalone Fair Events
 * site (#1852).
 *
 * Fair Audience and Fair Events Experimental are inactive for the whole
 * spec, and the site has no event feed — an administrator still
 * configures the channel on Fair Events → Event notifications, lists all
 * published local events, previews the email, sends a test and receives the
 * scheduled email at the one configured address.
 *
 * Covered: the channel starts off; a missing or invalid address blocks
 * turning it on, with a message; the wording is editable; preview and test
 * name their destination and use the saved settings; a test goes only to
 * the configured address and leaves the schedule alone; the scheduled send
 * lists published events only, reaches only that address and is not
 * repeated for the same week, also after the address changes; the
 * notification's own history shows each send and test with its recipient,
 * including a mail failure; turning the channel off stops scheduled sends.
 *
 * No mail leaves the host: fair-e2e-support.php captures wp_mail(), and
 * fair-e2e-fee-reminders.php makes it fail for one address on request.
 */

import { test, expect } from '@playwright/test';
import {
	wpCli,
	loginAsAdmin,
	resetCapturedMail,
	runScript,
} from '../support/wp-cli.js';

const SETTINGS_URL =
	'/wp-admin/admin.php?page=fair-events-event-notifications';
const RECIPIENT = 'organizer-1852@example.test';
const OTHER_RECIPIENT = 'second-1852@example.test';
const OPTIONAL_PLUGINS =
	'fair-audience-experimental fair-audience fair-events-experimental';

function fixture(args) {
	return runScript(
		'individual-email-fixture.php',
		'E2E_INDIVIDUAL_EMAIL',
		args
	);
}

function resetState() {
	wpCli('option delete fair_e2e_fail_mail_to', { allowFailure: true });
	// Settings, queued sends, history and the claimed send weeks of the
	// individual email this site started with.
	runScript(
		'notification-configurations-fixture.php',
		'E2E_NOTIFICATION_CONFIGURATIONS',
		'reset individual_email'
	);
	runScript(
		'notification-history-fixture.php',
		'E2E_NOTIFICATION_HISTORY',
		'clear individual_email'
	);
	resetCapturedMail();
}

function capturedMail() {
	const out = wpCli('option get fair_e2e_captured_mail --format=json', {
		allowFailure: true,
	}).trim();
	return out ? JSON.parse(out) : [];
}

function recipients(mail) {
	return mail.flatMap((entry) => [].concat(entry.to));
}

// The open notification's view: one notification is open at a time.
function channel(page) {
	return page.locator('.fair-events-notifications');
}

function openChannel(page, id, tab = '') {
	return page.goto(
		`${SETTINGS_URL}&configuration=${id}${tab ? `&tab=${tab}` : ''}`
	);
}

function listRow(page, name) {
	return page
		.getByRole('row')
		.filter({ has: page.getByRole('link', { name, exact: true }) });
}

test.describe('Individual email notifications on a standalone site', () => {
	const eventIds = [];
	let hiddenSourceIds = [];

	test.beforeAll(() => {
		wpCli(`plugin deactivate ${OPTIONAL_PLUGINS}`);
		// Sources left by other specs: this site is to have none.
		hiddenSourceIds = fixture('hide-sources').sourceIds;
		resetState();
	});

	test.afterAll(() => {
		if (eventIds.length) {
			fixture(`cleanup ${eventIds.join(' ')}`);
		}
		if (hiddenSourceIds.length) {
			fixture(`restore-sources ${hiddenSourceIds.join(' ')}`);
		}
		resetState();
		wpCli(
			'plugin activate fair-events-experimental fair-audience fair-audience-experimental'
		);
	});

	test('an administrator configures, previews, tests and receives the weekly email', async ({
		page,
	}) => {
		test.setTimeout(180000);
		await loginAsAdmin(page);
		await page.goto(SETTINGS_URL);

		// Fair Audience is inactive: bulk email is paused, this channel is not.
		await expect(
			listRow(page, 'Bulk email').getByText(
				/paused because Fair Audience is not active/
			)
		).toBeVisible();
		// No event feed exists and none is needed here.
		await expect(
			page.locator('.components-notice').getByText(
				/Individual email can send all published local events without one\./
			)
		).toBeVisible();

		await listRow(page, 'Individual email')
			.getByRole('link', { name: 'Edit' })
			.click();
		await expect(page).toHaveURL(/configuration=individual_email/);
		const own = channel(page);
		await expect(
			own.getByRole('heading', { name: 'Individual email' })
		).toBeVisible();

		const toggle = own.getByLabel(
			'Email the weekly summary to this address'
		);
		const saveButton = own.getByRole('button', {
			name: 'Save individual email settings',
		});
		await expect(toggle).not.toBeChecked();
		await expect(own.getByLabel('Send to')).toHaveValue('');
		await expect(own.getByLabel('Events to include')).toHaveValue('@local');
		await expect(
			own.getByText('Nothing is scheduled.', { exact: false })
		).toBeVisible();
		await expect(
			own.getByRole('button', { name: 'Send test email' })
		).toBeDisabled();

		// It cannot be turned on without an address, or with a list of them.
		await toggle.check();
		await expect(saveButton).toBeDisabled();
		await expect(
			own.getByText(
				'Enter the email address that receives the weekly email before turning it on.'
			)
		).toBeVisible();
		await own
			.getByLabel('Send to')
			.fill(`${RECIPIENT}, ${OTHER_RECIPIENT}`);
		await expect(saveButton).toBeDisabled();
		await expect(
			own.getByText(
				'Enter exactly one email address, for example name@example.com.'
			)
		).toBeVisible();

		// The server refuses the same, whatever the page allows.
		const refusal = await page.evaluate(
			(recipient) =>
				window.wp
					.apiFetch({
						path: '/fair-events/v1/event-notifications/individual-email',
						method: 'POST',
						data: { enabled: true, recipient },
					})
					.then(
						() => 'saved',
						(error) => error.code
					),
			`${RECIPIENT}, ${OTHER_RECIPIENT}`
		);
		expect(refusal).toBe('invalid_recipient');

		// Configure it, still off, with its own wording.
		await toggle.uncheck();
		await own.getByLabel('Send to').fill(RECIPIENT);
		await own.getByLabel('Send on').selectOption('3');
		await own.getByLabel('Send at').fill('06:45');
		await own
			.getByLabel('Skip the email when the week has no events')
			.uncheck();
		await own.getByLabel('Subject').fill('Organizer update {week_start}');
		await own
			.getByLabel('Text above the list of events')
			.fill('Hello <strong>team</strong>');
		await own.getByLabel('Text below the list of events').fill('See you');
		await expect(own.getByText('Unsaved changes')).toBeVisible();
		await expect(
			own.getByRole('button', { name: 'Preview next email' })
		).toBeDisabled();
		await saveButton.click();
		await expect(
			own.getByText('Individual email settings saved.').first()
		).toBeVisible();
		await expect(own.getByText('Unsaved changes')).toHaveCount(0);
		await expect(
			own.getByText('Nothing is scheduled.', { exact: false })
		).toBeVisible();

		// The saved settings survive a reload.
		await page.reload();
		await expect(own.getByLabel('Send to')).toHaveValue(RECIPIENT);
		await expect(own.getByLabel('Send at')).toHaveValue('06:45');
		await expect(own.getByLabel('Subject')).toHaveValue(
			'Organizer update {week_start}'
		);

		// Saved in another tab: the draft here is kept, with a warning.
		await own.getByLabel('Text below the list of events').fill('Draft');
		const otherTab = await page.context().newPage();
		await openChannel(otherTab, 'individual_email');
		const otherOwn = channel(otherTab);
		await otherOwn.getByLabel('Send at').fill('06:50');
		await otherOwn
			.getByRole('button', { name: 'Save individual email settings' })
			.click();
		await expect(
			otherOwn.getByText('Individual email settings saved.').first()
		).toBeVisible();
		await otherTab.close();
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		await expect(
			own.getByText(/These settings were saved somewhere else/)
		).toBeVisible();
		await expect(
			own.getByLabel('Text below the list of events')
		).toHaveValue('Draft');
		await expect(own.getByLabel('Send at')).toHaveValue('06:45');
		// Undoing the edit leaves a clean form with the newer saved time.
		await own.getByLabel('Text below the list of events').fill('See you');
		await expect(own.getByText('Unsaved changes')).toHaveCount(0);
		await expect(own.getByLabel('Send at')).toHaveValue('06:50');
		await expect(
			own.getByText(/These settings were saved somewhere else/)
		).toHaveCount(0);

		const preview = own.getByRole('group', { name: 'Email preview' });

		// A published and a draft event in the previewed week.
		const previewEvents = fixture('events preview');
		eventIds.push(previewEvents.eventId, previewEvents.draftId);

		await own.getByRole('button', { name: 'Preview next email' }).click();
		await expect(
			preview.getByRole('link', { name: previewEvents.eventTitle })
		).toHaveAttribute('href', previewEvents.eventUrl);
		await expect(preview.getByText(previewEvents.draftTitle)).toHaveCount(
			0
		);
		// Events are listed day by day, like the subscribers' weekly email.
		await expect(
			preview.getByRole('heading', { level: 3 }).first()
		).toHaveText(/^\w+, \w+ \d+$/);
		await expect(preview.getByText('Hello team')).toBeVisible();
		await expect(preview.getByText('See you')).toBeVisible();
		await expect(own.getByText(RECIPIENT, { exact: false }).first()).toBeVisible();
		await expect(
			own.getByText(
				`Organizer update ${previewEvents.weekStart}`
			)
		).toBeVisible();

		// The test works while the channel is off and goes to that address only.
		const before = fixture('state');
		await own
			.getByRole('button', { name: `Send test email to ${RECIPIENT}` })
			.click();
		await expect(
			own
				.getByText(
					`Test email handed over for delivery to ${RECIPIENT}. The schedule is unchanged.`
				)
				.first()
		).toBeVisible();
		let mail = capturedMail();
		expect(recipients(mail)).toEqual([RECIPIENT]);
		expect(mail[0].subject).toBe(
			`Organizer update ${previewEvents.weekStart}`
		);
		expect(mail[0].body).toContain('E2E Individual &lt;Jam&gt; &amp; Friends');
		expect(mail[0].body).toContain(previewEvents.eventUrl);
		expect(mail[0].body).not.toContain(previewEvents.draftTitle);
		expect(mail[0].body).toContain('<strong>team</strong>');
		// The subscribers' branded layout, without their greeting or link.
		expect(mail[0].body).toMatch(/<h3\b[^>]*>\w+, \w+ \d+<\/h3>/);
		expect(mail[0].body).toContain('max-width: 600px');
		expect(mail[0].body).toMatch(/Thanks,<br>The .+ Team/);
		expect(mail[0].body).not.toContain('Manage your preferences');
		// A test is not a scheduled send.
		expect(fixture('state')).toEqual(before);

		// Turn it on: the next send is scheduled, nothing is sent by saving.
		resetCapturedMail();
		await toggle.check();
		await saveButton.click();
		await expect(
			own.getByText('Individual email settings saved.').first()
		).toBeVisible();
		await expect(own.getByText(/^Next send: /)).toBeVisible();
		expect(capturedMail()).toEqual([]);
		expect(fixture('state').nextRun.timestamp).toBeGreaterThan(
			Date.now() / 1000
		);

		// The scheduled send for this week: published events, one recipient.
		const nowEvents = fixture('events now');
		eventIds.push(nowEvents.eventId, nowEvents.draftId);
		let state = fixture('run');
		expect(state.runs).toHaveLength(1);
		expect(state.runs[0]).toMatchObject({
			status: 'sent',
			destination: RECIPIENT,
			week_start: nowEvents.weekStart,
		});
		mail = capturedMail();
		expect(recipients(mail)).toEqual([RECIPIENT]);
		expect(mail[0].body).toContain(nowEvents.eventUrl);
		expect(mail[0].body).not.toContain(nowEvents.draftTitle);
		// The following send stays scheduled.
		expect(state.nextRun.timestamp).toBeGreaterThan(Date.now() / 1000);

		// The same week is never sent twice, also after the address changes.
		await own.getByLabel('Send to').fill(OTHER_RECIPIENT);
		await saveButton.click();
		await expect(
			own.getByText('Individual email settings saved.').first()
		).toBeVisible();
		state = fixture('run');
		expect(state.runs).toHaveLength(1);
		expect(recipients(capturedMail())).toEqual([RECIPIENT]);

		// Its own history lists the scheduled send and the test, and the
		// send's details name the week, outcome and recipient.
		await openChannel(page, 'individual_email', 'history');
		const history = own.getByRole('table');
		await expect(history.getByRole('row')).toHaveCount(3);
		const scheduled = history
			.getByRole('row')
			.filter({ has: page.getByRole('cell', { name: 'Scheduled', exact: true }) });
		await expect(
			scheduled.getByText('Accepted', { exact: true })
		).toBeVisible();
		await expect(
			history.getByRole('row').filter({ has: page.getByRole('cell', { name: 'Test', exact: true }) })
		).toHaveCount(1);
		await expect(
			own.getByText(/does not confirm that anyone received it/)
		).toBeVisible();
		await scheduled.getByRole('link').click();
		await expect(page).toHaveURL(/execution=\d+/);
		await expect(own.getByText('Accepted by the provider')).toBeVisible();
		await expect(
			own.getByRole('table').getByText(RECIPIENT)
		).toBeVisible();
		await own.getByRole('link', { name: '← Back to the history' }).click();
		await expect(history.getByRole('row')).toHaveCount(3);

		// A mail failure is visible, and Telegram stays usable.
		resetState();
		wpCli(`option update fair_e2e_fail_mail_to ${RECIPIENT}`);
		await openChannel(page, 'individual_email');
		await own.getByLabel('Send to').fill(RECIPIENT);
		await own
			.getByLabel('Skip the email when the week has no events')
			.uncheck();
		await toggle.check();
		await saveButton.click();
		await expect(
			own.getByText('Individual email settings saved.').first()
		).toBeVisible();
		await own
			.getByRole('button', { name: `Send test email to ${RECIPIENT}` })
			.click();
		await expect(
			own
				.getByText(`The test email to ${RECIPIENT} could not be sent.`)
				.first()
		).toBeVisible();
		state = fixture('run');
		expect(state.runs[0]).toMatchObject({
			status: 'failed',
			destination: RECIPIENT,
		});
		await openChannel(page, 'individual_email', 'history');
		const failed = own
			.getByRole('table')
			.getByRole('row')
			.filter({ has: page.getByRole('cell', { name: 'Scheduled', exact: true }) });
		await expect(
			failed.getByText('Failed', { exact: true })
		).toBeVisible();
		await failed.getByRole('link').click();
		await expect(
			own.getByText('The mail system refused the message.')
		).toBeVisible();
		await openChannel(page, 'telegram');
		await expect(
			channel(page).getByRole('button', {
				name: 'Save Telegram settings',
			})
		).toBeEnabled();

		// Turned off, a queued send does nothing and nothing stays scheduled.
		resetState();
		await openChannel(page, 'individual_email');
		await own.getByLabel('Send to').fill(RECIPIENT);
		await toggle.check();
		await saveButton.click();
		await expect(own.getByText(/^Next send: /)).toBeVisible();
		await toggle.uncheck();
		await saveButton.click();
		await expect(
			own.getByText('Nothing is scheduled.', { exact: false })
		).toBeVisible();
		state = fixture('run');
		expect(state.nextRun).toBeNull();
		expect(state.runs).toEqual([]);
		expect(capturedMail()).toEqual([]);
		// The address and wording are kept while it is off.
		await expect(own.getByLabel('Send to')).toHaveValue(RECIPIENT);
	});
});
