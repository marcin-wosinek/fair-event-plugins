/**
 * E2E: individual email event notifications on a standalone Fair Events
 * site (#1852).
 *
 * Fair Audience and Fair Events Experimental are inactive for the whole
 * spec, and the site has no event source — an administrator still
 * configures the channel on Fair Events → Event notifications, lists all
 * published local events, previews the email, sends a test and receives the
 * scheduled email at the one configured address.
 *
 * Covered: the channel starts off; a missing or invalid address blocks
 * turning it on, with a message; the wording is editable; preview and test
 * name their destination and use the saved settings; a test goes only to
 * the configured address and leaves the schedule and history alone; the
 * scheduled send lists published events only, reaches only that address and
 * is not repeated for the same week, also after the address changes; a mail
 * failure is shown in the delivery status; turning the channel off stops
 * scheduled sends.
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
const OPTIONS = [
	'fair_events_notification_individual_email',
	'fair_events_notification_individual_email_next_run',
	'fair_events_notification_individual_email_runs',
	'fair_events_notification_individual_email_last_sent_week',
	'fair_e2e_fail_mail_to',
];

function fixture(args) {
	return runScript(
		'individual-email-fixture.php',
		'E2E_INDIVIDUAL_EMAIL',
		args
	);
}

function resetState() {
	for (const option of OPTIONS) {
		wpCli(`option delete ${option}`, { allowFailure: true });
	}
	wpCli('cron event delete fair_events_notification_individual_email', {
		allowFailure: true,
	});
	// A send week claimed by an earlier run would block this run's send.
	wpCli(
		`eval 'global $wpdb; $wpdb->delete( $wpdb->prefix . "fair_events_weekly_notification_deliveries", array( "provider" => "individual_email" ) );'`,
		{ allowFailure: true }
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

function channel(page, name) {
	return page
		.locator('.fair-events-notifications__channel')
		.filter({ has: page.getByRole('heading', { name, exact: true }) });
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

		const own = channel(page, 'Individual email');
		await expect(own).toBeVisible();
		// Fair Audience is inactive: bulk email is paused, this channel is not.
		await expect(
			channel(page, 'Bulk email').getByText(
				/paused because Fair Audience is not active/
			)
		).toBeVisible();
		// No event source exists and none is needed here.
		await expect(
			page.getByText(
				/Individual email can send all published local events without one\./
			)
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

		// The delivery status names the week, outcome and destination.
		await page.reload();
		await expect(own.getByText('Handed over for delivery')).toBeVisible();
		await expect(
			own.getByText(/does not confirm that it reached the inbox/)
		).toBeVisible();
		await expect(
			own
				.locator('.fair-events-notifications__row')
				.getByText(RECIPIENT)
		).toBeVisible();

		// A mail failure is visible, and Telegram stays usable.
		resetState();
		wpCli(`option update fair_e2e_fail_mail_to ${RECIPIENT}`);
		await page.reload();
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
		await page.reload();
		await expect(own.getByText('Failed', { exact: true })).toBeVisible();
		await expect(
			own.getByText(/could not hand the email over for delivery/)
		).toBeVisible();
		await expect(
			channel(page, 'Telegram').getByRole('button', {
				name: 'Save Telegram settings',
			})
		).toBeEnabled();

		// Turned off, a queued send does nothing and nothing stays scheduled.
		resetState();
		await page.reload();
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
