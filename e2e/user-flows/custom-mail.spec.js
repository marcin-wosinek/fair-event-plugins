/**
 * E2E: an organizer emails the participants of one event occurrence from
 * Fair Audience → Custom Mail (#1784).
 *
 * The flow runs twice. First with fair-audience-experimental deactivated:
 * the page asks for an event, previews that occurrence's participant, sends,
 * reports the result and lists the message in Mail History. Then with both
 * plugins active: Custom Mail appears once in the menu and on the page, the
 * experimental "All audience" choice is offered, and a send still delivers
 * one email per recipient.
 *
 * The event, its two occurrences and the participants are created through
 * the admin REST API and removed afterwards. Mail is captured by
 * fair-e2e-support.php and read back through fair-e2e-fee-reminders.php.
 */

import { test, expect } from '@playwright/test';
import {
	ADMIN_PASSWORD,
	ADMIN_USER,
	loginAsAdmin,
	wpCli,
} from '../support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const PAGE_URL = '/wp-admin/admin.php?page=fair-audience-custom-mail';

test.describe('Email the participants of an event occurrence', () => {
	const created = {
		eventPostId: 0,
		occurrenceId: 0,
		otherOccurrenceId: 0,
		participantIds: [],
		subjects: [],
	};
	let stamp;
	let eventTitle;
	let attendee;
	let otherDateAttendee;

	const remove = (request, path) =>
		request.delete(`/wp-json${path}`, { headers: adminHeaders });

	const post = async (request, path, data) => {
		const res = await request.post(`/wp-json${path}`, {
			headers: adminHeaders,
			data,
		});
		expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
		return res.json();
	};

	/** Recipients of captured mail carrying this subject. */
	const deliveredTo = async (request, subject) => {
		const res = await request.get(
			'/wp-json/fair-e2e/v1/fee-reminders/mail',
			{ headers: adminHeaders }
		);
		expect(res.ok()).toBeTruthy();
		return (await res.json())
			.filter((entry) => entry.subject === subject)
			.flatMap((entry) => entry.to);
	};

	test.beforeEach(async ({ request }) => {
		stamp = Date.now();
		eventTitle = `Mail Flow Workshop ${stamp}`;
		attendee = {
			name: 'Marta',
			surname: `Attendee${stamp}`,
			email: `mail-flow-attendee-${stamp}@example.test`,
		};
		otherDateAttendee = {
			name: 'Otto',
			surname: `Otherdate${stamp}`,
			email: `mail-flow-other-${stamp}@example.test`,
		};

		created.eventPostId = (
			await post(request, '/wp/v2/fair_event', {
				title: eventTitle,
				status: 'publish',
			})
		).id;
		const series = await post(request, '/fair-events/v1/event-dates', {
			title: eventTitle,
			start_datetime: '2037-05-02 10:00:00',
			end_datetime: '2037-05-02 12:00:00',
			rrule: 'FREQ=WEEKLY;COUNT=2',
		});
		created.occurrenceId = series.id;
		created.otherOccurrenceId = series.generated_occurrences[0].id;
		const link = await request.put(
			`/wp-json/fair-events/v1/event-dates/${created.occurrenceId}`,
			{ headers: adminHeaders, data: { event_id: created.eventPostId } }
		);
		expect(link.ok()).toBeTruthy();

		for (const [person, occurrence] of [
			[attendee, created.occurrenceId],
			[otherDateAttendee, created.otherOccurrenceId],
		]) {
			const participant = await post(
				request,
				'/fair-audience/v1/participants',
				{ ...person, email_profile: 'marketing' }
			);
			created.participantIds.push(participant.id);
			await post(
				request,
				`/fair-audience/v1/event-dates/${occurrence}/participants/batch`,
				{ participant_ids: [participant.id], label: 'signed_up' }
			);
		}
		await remove(request, '/fair-e2e/v1/fee-reminders/mail');
	});

	test.afterEach(async ({ request }) => {
		// Always bring the companion back, whatever the test did.
		wpCli('plugin activate fair-audience-experimental', {
			allowFailure: true,
		});

		const history = await request.get(
			'/wp-json/fair-audience/v1/custom-mail',
			{ headers: adminHeaders }
		);
		if (history.ok()) {
			for (const mail of await history.json()) {
				if (created.subjects.includes(mail.subject)) {
					await remove(
						request,
						`/fair-audience/v1/custom-mail/${mail.id}`
					);
				}
			}
		}
		for (const id of created.participantIds) {
			await remove(request, `/fair-audience/v1/participants/${id}`);
		}
		if (created.occurrenceId) {
			await remove(
				request,
				`/fair-events/v1/event-dates/${created.occurrenceId}`
			);
		}
		if (created.eventPostId) {
			await remove(
				request,
				`/wp/v2/fair_event/${created.eventPostId}?force=true`
			);
		}
		await remove(request, '/fair-e2e/v1/fee-reminders/mail');
		created.participantIds = [];
		created.subjects = [];
	});

	/**
	 * Pick the first occurrence, write the email and send it.
	 *
	 * @param {import('@playwright/test').Page} page    Playwright page.
	 * @param {string}                          subject Email subject.
	 */
	async function composeAndSend(page, subject) {
		created.subjects.push(subject);

		await page
			.getByRole('combobox', { name: 'Event' })
			.selectOption(String(created.occurrenceId));

		// Only this occurrence's participant is previewed.
		const preview = page.locator('.fair-audience-custom-mail__preview');
		await expect(preview).toContainText(
			'1 person will receive this email.'
		);
		await expect(preview).toContainText(attendee.email);
		await expect(preview).not.toContainText(otherDateAttendee.email);

		await page.getByRole('textbox', { name: 'Subject' }).fill(subject);

		// Sending stays unavailable, with the reason, until there is content.
		const sendButton = page.getByRole('button', { name: 'Send email' });
		await expect(sendButton).toBeDisabled();
		await expect(page.getByText('Write the email content.')).toBeVisible();

		const editorBody = page
			.frameLocator('#custom-mail-content_ifr')
			.locator('body');
		await editorBody.click();
		await page.keyboard.type('Doors open at half past nine.');

		await expect(sendButton).toBeEnabled();
		await sendButton.click();
	}

	test('with the experimental plugin deactivated: compose, preview, send, history', async ({
		page,
		request,
	}) => {
		wpCli('plugin deactivate fair-audience-experimental');
		const subject = `Mail flow standalone ${stamp}`;

		await loginAsAdmin(page);
		await page.goto(PAGE_URL);

		const eventSelect = page.getByRole('combobox', { name: 'Event' });
		await expect(eventSelect).toBeVisible();

		// Standalone: an event is required and nothing experimental shows.
		await expect(
			eventSelect.locator('option', { hasText: 'All audience' })
		).toHaveCount(0);
		await expect(
			page.getByRole('button', { name: 'Insert photo upload link' })
		).toHaveCount(0);
		await expect(
			page.getByText(
				'Select the event whose participants should receive this email.'
			)
		).toHaveCount(0);

		await composeAndSend(page, subject);

		const result = page.locator('.fair-audience-custom-mail__result');
		await expect(result).toContainText('1 email was sent.');

		// The form is ready for the next email and history has this one.
		await expect(
			page.getByRole('textbox', { name: 'Subject' })
		).toHaveValue('');
		const historyRow = page.locator('tr', { hasText: subject });
		await expect(historyRow).toContainText(eventTitle);

		expect(await deliveredTo(request, subject)).toEqual([attendee.email]);

		// Deleting the record asks first, naming the message.
		await historyRow.getByRole('button', { name: 'Delete' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText(subject);
		await dialog.getByRole('button', { name: 'Delete record' }).click();
		await expect(page.locator('tr', { hasText: subject })).toHaveCount(0);
	});

	test('with both plugins active: one page, one email per recipient', async ({
		page,
		request,
	}) => {
		const subject = `Mail flow both ${stamp}`;

		await loginAsAdmin(page);
		await page.goto(PAGE_URL);

		// One menu entry and one mounted page.
		await expect(
			page.locator(
				'#adminmenu a[href="admin.php?page=fair-audience-custom-mail"]'
			)
		).toHaveCount(1);
		await expect(
			page.locator('#fair-audience-custom-mail-root')
		).toHaveCount(1);
		await expect(page.locator('.fair-audience-custom-mail')).toHaveCount(1);
		await expect(
			page.getByRole('heading', { name: 'Custom Mail', level: 1 })
		).toHaveCount(1);

		// The experimental all-audience choice is offered here.
		await expect(
			page
				.getByRole('combobox', { name: 'Event' })
				.locator('option', { hasText: 'All audience' })
		).toHaveCount(1);

		await composeAndSend(page, subject);

		await expect(
			page.locator('.fair-audience-custom-mail__result')
		).toContainText('1 email was sent.');
		await expect(page.locator('tr', { hasText: subject })).toHaveCount(1);

		expect(await deliveredTo(request, subject)).toEqual([attendee.email]);
	});
});
