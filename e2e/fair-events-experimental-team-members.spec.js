/**
 * Team members in Fair Events Experimental (#2394).
 *
 * Creates a profile in Fair Events → Team members, adds it to an event in
 * Manage Event's Event Details, removes it again, and checks that the
 * profile stays in the directory.
 *
 * Run: `npm run test:e2e:local -- e2e/fair-events-experimental-team-members.spec.js`.
 */

import { test, expect } from '@playwright/test';
import { wpCli, loginAsAdmin } from './support/wp-cli.js';
import { setExperimentalFeature } from './support/experimental-features.js';

const DIRECTORY_URL = '/wp-admin/admin.php?page=fair-events-team-members';

const manageUrl = (id) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${id}`;

test.describe('Team members', () => {
	let previous;
	let eventDateId;
	let memberId;

	test.beforeAll(() => {
		// The bundle is off by default.
		previous = setExperimentalFeature('team-members', true);
		const out = wpCli(
			`eval 'echo "EVENT_DATE:" . (int) FairEvents\\Models\\EventDates::create_standalone( array( "title" => "Team flow event", "start_date" => "2035-09-03", "end_date" => "2035-09-03", "occurrence_type" => "single" ) );'`
		);
		eventDateId = Number(out.match(/EVENT_DATE:(\d+)/)[1]);
	});

	test.afterAll(() => {
		if (eventDateId) {
			wpCli(
				`eval 'FairEvents\\Models\\EventDates::delete_by_id( ${eventDateId} );'`,
				{ allowFailure: true }
			);
		}
		if (memberId) {
			wpCli(
				`eval '( new FairEventsExperimental\\Models\\TeamMemberRepository() )->delete( ${memberId} );'`,
				{ allowFailure: true }
			);
		}
		setExperimentalFeature('team-members', previous);
	});

	test('creates a profile, adds it to an event and removes it again', async ({
		page,
	}) => {
		const name = `Ana ${Date.now()}`;
		await loginAsAdmin(page);

		await page.goto(DIRECTORY_URL);
		await page
			.getByRole('button', { name: 'Add team member' })
			.first()
			.click();
		const save = page.getByRole('button', { name: 'Add team member' });
		await expect(page.getByText('Enter a name to save.')).toBeVisible();
		await page.getByLabel('Name (required)').fill(name);
		await page.getByLabel('Surname').fill('Ruiz');
		await page.getByLabel('Phone number').fill('+34 600 000 001');
		await page.getByLabel('Email address').fill('not-an-email');
		await save.click();
		await expect(
			page.getByText('Enter a valid email address', { exact: false })
		).toBeVisible();
		await page.getByLabel('Email address').fill('');
		await page.getByLabel('Grammatical gender').selectOption('female');
		const created = page.waitForResponse(
			(res) =>
				res.url().includes('team-members') &&
				'POST' === res.request().method() &&
				201 === res.status()
		);
		await save.click();
		memberId = (await (await created).json()).id;
		await expect(
			page.locator('.components-notice__content', {
				hasText: 'Team member added.',
			})
		).toBeVisible();

		await page.goto(manageUrl(eventDateId));
		const picker = page.getByRole('combobox', {
			name: 'Add a team member',
		});
		await picker.fill(name);
		await page.getByRole('option', { name: `${name} Ruiz` }).click();
		await page.getByLabel('Role', { exact: true }).fill('teacher');
		await page.getByRole('button', { name: 'Add', exact: true }).click();
		await expect(
			page.locator('.components-notice__content', {
				hasText: `${name} Ruiz (teacher) was added.`,
			})
		).toBeVisible();

		await page.reload();
		const remove = page.getByRole('button', {
			name: `Remove ${name} Ruiz (teacher)`,
		});
		await expect(remove).toBeVisible();
		await remove.click();
		await expect(
			page.locator('.components-notice__content', {
				hasText: `${name} Ruiz (teacher) was removed.`,
			})
		).toBeVisible();
		await expect(remove).toHaveCount(0);

		await page.goto(DIRECTORY_URL);
		const row = page
			.getByRole('link', { name: `${name} Ruiz` })
			.locator('xpath=ancestor::tr');
		await expect(row).toContainText('+34 600 000 001');
		await expect(row).toContainText('None');
	});
});
