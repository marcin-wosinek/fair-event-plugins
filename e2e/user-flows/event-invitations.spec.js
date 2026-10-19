/**
 * E2E: an organizer reviews who an event invitation reaches before sending
 * it, and confirms disconnecting Instagram in an in-page popup (#1776).
 *
 * Invitations run on both screens that send them. Two groups share members;
 * one member is already signed up and one declined marketing email. The
 * popup names the event and its date, keeps group membership apart from the
 * people who will receive the invitation, and the send mails exactly those
 * people. Cancelling sends nothing.
 *
 * The event, participants and groups are created through the admin REST API
 * and removed afterwards. Mail is captured by fair-e2e-support.php and read
 * back through fair-e2e-fee-reminders.php. Instagram is never called: the
 * connection is seeded as site settings and only cleared.
 */

import { test, expect } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USER, loginAsAdmin } from '../support/wp-cli.js';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString('base64'),
};

const MAIL_PATH = '/wp-json/fair-e2e/v1/fee-reminders/mail';

test.describe('Review event invitations before sending', () => {
	const created = { eventId: 0, dateId: 0, participants: {}, groups: [] };
	let stamp;
	let eventTitle;

	const post = async (request, path, data) => {
		const res = await request.post(`/wp-json${path}`, {
			headers: adminHeaders,
			data,
		});
		expect(res.ok(), `${path}: ${await res.text()}`).toBeTruthy();
		return res.json();
	};

	const delivered = async (request) => {
		const res = await request.get(MAIL_PATH, { headers: adminHeaders });
		expect(res.ok()).toBeTruthy();
		return (await res.json())
			.filter((entry) => entry.subject.includes(eventTitle))
			.flatMap((entry) => entry.to)
			.sort();
	};

	const email = (key) => created.participants[key].email;

	test.beforeEach(async ({ request }) => {
		stamp = Date.now();
		eventTitle = `Invitation Review ${stamp}`;
		created.participants = {};
		created.groups = [];

		created.eventId = (
			await post(request, '/wp/v2/fair_event', {
				title: eventTitle,
				status: 'publish',
			})
		).id;
		created.dateId = (
			await post(request, '/fair-events/v1/event-dates', {
				title: eventTitle,
				start_date: '2037-05-02',
				start_time: '18:30:00',
				end_date: '2037-05-02',
				end_time: '20:30:00',
			})
		).id;
		const link = await request.put(
			`/wp-json/fair-events/v1/event-dates/${created.dateId}`,
			{ headers: adminHeaders, data: { event_id: created.eventId } }
		);
		expect(link.ok()).toBeTruthy();

		const people = {
			ada: 'marketing',
			bo: 'marketing',
			cy: 'declined',
			di: 'marketing',
		};
		for (const [key, profile] of Object.entries(people)) {
			const address = `review-${key}-${stamp}@example.test`;
			const participant = await post(
				request,
				'/fair-audience/v1/participants',
				{
					name: `Review ${key}`,
					surname: `${stamp}`,
					email: address,
					email_profile: profile,
				}
			);
			created.participants[key] = { id: participant.id, email: address };
		}
		await post(
			request,
			`/fair-audience/v1/event-dates/${created.dateId}/participants/batch`,
			{
				participant_ids: [created.participants.di.id],
				label: 'signed_up',
			}
		);

		for (const [name, members] of [
			[`Review crew ${stamp}`, ['ada', 'bo', 'cy']],
			[`Review readers ${stamp}`, ['bo', 'cy', 'di']],
		]) {
			const group = await post(request, '/fair-audience/v1/groups', {
				name,
			});
			created.groups.push({ id: group.id, name });
			for (const key of members) {
				await post(
					request,
					`/fair-audience/v1/groups/${group.id}/participants`,
					{ participant_id: created.participants[key].id }
				);
			}
			await post(
				request,
				`/fair-events/v1/event-dates/${created.dateId}/group-permission-rules`,
				{ group_id: group.id, permission_type: 'invited' }
			);
		}

		await request.delete(MAIL_PATH, { headers: adminHeaders });
	});

	test.afterEach(async ({ request }) => {
		const remove = (path) =>
			request.delete(`/wp-json${path}`, { headers: adminHeaders });
		for (const { id } of created.groups) {
			await remove(`/fair-audience/v1/groups/${id}`);
		}
		for (const { id } of Object.values(created.participants)) {
			await remove(`/fair-audience/v1/participants/${id}`);
		}
		await remove(`/fair-events/v1/event-dates/${created.dateId}`);
		await remove(`/wp/v2/fair_event/${created.eventId}?force=true`);
		await remove('/fair-e2e/v1/fee-reminders/mail');
	});

	test('from Event Participants: cancel sends nothing, send reaches the summarized people', async ({
		page,
		request,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			`/wp-admin/admin.php?page=fair-audience-event-participants&event_date_id=${created.dateId}`
		);

		const open = async () => {
			await page.getByRole('button', { name: 'Send Invitation' }).click();
			const dialog = page.getByRole('dialog', {
				name: 'Send Event Invitations',
			});
			for (const { name } of created.groups) {
				await dialog.getByLabel(new RegExp(name)).check();
			}
			return dialog;
		};

		let dialog = await open();
		const summary = dialog.getByRole('region', {
			name: 'Invitation summary',
		});
		await expect(summary).toContainText(
			'6 group memberships in total, 4 different people selected.'
		);
		await expect(summary).toContainText(`Invitation to ${eventTitle} on`);
		await expect(summary).toContainText(
			'2 people will receive this invitation.'
		);
		await expect(summary).toContainText(
			'1 is already signed up for this date.'
		);
		await expect(summary).toContainText(
			'1 has not confirmed they want marketing emails, or opted out.'
		);

		await dialog.getByRole('button', { name: 'Cancel' }).click();
		await expect(dialog).toBeHidden();
		expect(await delivered(request)).toEqual([]);

		dialog = await open();
		await dialog
			.getByRole('button', { name: 'Send 2 invitations' })
			.click();
		await expect(dialog).toBeHidden();
		await expect(
			page.locator('.components-notice').filter({
				hasText: 'Invitations sent to 2 participants',
			})
		).toBeVisible();
		expect(await delivered(request)).toEqual(
			[email('ada'), email('bo')].sort()
		);
	});

	test('from the Audience tab: sends to the invited groups as summarized', async ({
		page,
		request,
	}) => {
		await loginAsAdmin(page);
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${created.dateId}&tab=audience`
		);

		await page
			.getByRole('button', { name: 'Send Invitations' })
			.first()
			.click();
		const dialog = page.getByRole('dialog', { name: 'Send Invitations' });
		const summary = dialog.getByRole('region', {
			name: 'Invitation summary',
		});
		for (const { name } of created.groups) {
			await expect(summary).toContainText(`${name} — 3 members`);
		}
		await expect(summary).toContainText(
			'2 people will receive this invitation.'
		);

		await dialog
			.getByRole('button', { name: 'Send 2 invitations' })
			.click();
		await expect(dialog).toBeHidden();
		await expect(page.getByText('2 invitations sent.')).toBeVisible();
		expect(await delivered(request)).toEqual(
			[email('ada'), email('bo')].sort()
		);
	});
});

test.describe('Disconnect Instagram', () => {
	const CONNECTED = {
		fair_audience_instagram_access_token: 'e2e-synthetic-token',
		fair_audience_instagram_user_id: '17840000000000001',
		fair_audience_instagram_username: 'e2e_demo_account',
		fair_audience_instagram_connected: true,
	};

	const settings = async (request, data) => {
		const res = data
			? await request.post('/wp-json/wp/v2/settings', {
					headers: adminHeaders,
					data,
				})
			: await request.get('/wp-json/wp/v2/settings', {
					headers: adminHeaders,
				});
		expect(res.ok()).toBeTruthy();
		return res.json();
	};

	test.afterEach(async ({ request }) => {
		await settings(request, {
			fair_audience_instagram_access_token: '',
			fair_audience_instagram_user_id: '',
			fair_audience_instagram_username: '',
			fair_audience_instagram_token_expires: 0,
			fair_audience_instagram_connected: false,
		});
	});

	test('asks in a popup naming the account, then clears the connection', async ({
		page,
		request,
	}) => {
		await settings(request, CONNECTED);
		let nativeDialog = false;
		page.on('dialog', (native) => {
			nativeDialog = true;
			native.dismiss();
		});

		await loginAsAdmin(page);
		await page.goto('/wp-admin/admin.php?page=fair-audience-settings');
		await page.getByRole('button', { name: 'Disconnect' }).click();

		const dialog = page.getByRole('dialog', {
			name: 'Disconnect Instagram?',
		});
		await expect(dialog).toContainText(
			'Disconnect the Instagram account @e2e_demo_account from this site?'
		);
		await expect(dialog).not.toContainText('e2e-synthetic-token');

		await dialog.getByRole('button', { name: 'Keep connected' }).click();
		await expect(dialog).toBeHidden();
		expect(
			(await settings(request)).fair_audience_instagram_connected
		).toBe(true);

		await page.getByRole('button', { name: 'Disconnect' }).click();
		await dialog
			.getByRole('button', { name: 'Disconnect Instagram' })
			.click();
		await expect(dialog).toBeHidden();
		await expect(
			page.getByRole('button', { name: 'Connect with Instagram' })
		).toBeVisible();

		const after = await settings(request);
		expect(after.fair_audience_instagram_connected).toBeFalsy();
		expect(after.fair_audience_instagram_access_token).toBe('');
		expect(nativeDialog).toBe(false);
	});
});
