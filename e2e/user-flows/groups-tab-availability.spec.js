/**
 * E2E: the Groups tab on Manage Event is offered only when it can work (#1716).
 *
 * The tab reads group pricing and permission rules from Fair Events
 * Experimental's `ticketing` bundle and the group list from Fair Audience
 * Experimental's `groups` bundle. With all of that available an administrator
 * opens Groups and sees the event's existing rules. With any one of them
 * missing the tab is not offered — rather than opening onto a
 * `rest_no_route` error — and a bookmarked `tab=groups` URL falls back to
 * Event Details.
 *
 * Feature options are toggled the same way as in
 * fair-audience-experimental-feature-flags.spec.js. The plugin set and both
 * options are put back after every case, and the last case checks the seeded
 * rules are still there after all the toggling.
 */

import { test, expect } from '../support/fixtures.js';
import { loginAsAdmin, runScript, wpCli } from '../support/wp-cli.js';

const EVENTS_OPTION = 'fair_events_experimental_features';
const AUDIENCE_OPTION = 'fair_audience_experimental_features';

/**
 * Stored value of a feature option. An unset option reads as `[]` (the
 * registered default), which is treated the same as an empty map.
 */
function readOption(option) {
	const out = wpCli(`option get ${option} --format=json`, {
		allowFailure: true,
	}).trim();
	try {
		const value = JSON.parse(out.split('\n').pop());
		return value && !Array.isArray(value) ? value : {};
	} catch {
		return {};
	}
}

function updateOption(option, value) {
	const json = JSON.stringify(value).replace(/'/g, "'\\''");
	wpCli(`option update ${option} '${json}' --format=json`);
}

/**
 * Put a feature option back to `value`. The option is deleted first: its
 * sanitize callback keeps stored keys that an update leaves out, so an update
 * alone would not clear a bundle this spec switched off.
 */
function restoreOption(option, value) {
	wpCli(`option delete ${option}`, { allowFailure: true });
	if (Object.keys(value).length > 0) {
		updateOption(option, value);
	}
}

/** Switch one bundle off, keeping the rest of the stored option. */
function turnBundleOff(option, bundle, original) {
	updateOption(option, { ...original, [bundle]: false });
}

const manageEventUrl = (eventDateId, tab) =>
	`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${eventDateId}` +
	(tab ? `&tab=${tab}` : '');

/** Open Manage Event on `tab=groups` and assert the tab is not offered. */
async function expectGroupsUnavailable(page, eventDateId) {
	await page.goto(manageEventUrl(eventDateId, 'groups'));

	// The page has mounted its tabs, so a missing Groups tab is a real absence.
	const eventDetails = page.getByRole('tab', { name: 'Event Details' });
	await expect(eventDetails).toBeVisible();
	await expect(page.getByRole('tab', { name: 'Groups' })).toHaveCount(0);

	// The bookmarked URL falls back to Event Details, with no failed load.
	await expect(eventDetails).toHaveAttribute('aria-selected', 'true');
	await expect(
		page.getByText('Group rules could not be loaded.')
	).toHaveCount(0);
	await expect(
		page.getByRole('heading', { name: 'Group Rules' })
	).toHaveCount(0);
}

/** Open Groups from the tab list and assert the seeded rules are shown. */
async function expectGroupsShowsRules(page, eventDateId, groupName) {
	const failedRequests = [];
	page.on('response', (response) => {
		if (
			response.status() === 404 &&
			/group-(pricing|permission)-rules/.test(response.url())
		) {
			failedRequests.push(response.url());
		}
	});

	await page.goto(manageEventUrl(eventDateId));
	const groupsTab = page.getByRole('tab', { name: 'Groups' });
	await expect(groupsTab).toHaveCount(1);
	await groupsTab.click();
	await expect(page).toHaveURL(/[?&]tab=groups\b/);

	await expect(
		page.getByRole('heading', { name: 'Group Rules' })
	).toBeVisible();
	await expect(page.getByRole('heading', { name: groupName })).toBeVisible();
	await expect(page.getByText('Discount: 20%')).toBeVisible();
	await expect(page.getByLabel('View signups').first()).toBeChecked();
	await expect(
		page.getByText('Group rules could not be loaded.')
	).toHaveCount(0);
	await expect(
		page.getByText('No group rules yet. Add one below.')
	).toHaveCount(0);
	expect(failedRequests, 'group rule requests answered 404').toEqual([]);
}

test.describe('Groups tab availability', () => {
	test.describe.configure({ mode: 'serial' });

	let event;
	let rules;
	let eventsFeatures;
	let audienceFeatures;

	/**
	 * Put the plugin set and both feature options back as the suite found
	 * them. Runs after every case, in a hook rather than a `finally`, so a case
	 * that times out cannot leave a bundle off for the rest of the run.
	 */
	function restoreAvailability() {
		wpCli('plugin activate fair-events-experimental', {
			allowFailure: true,
		});
		restoreOption(EVENTS_OPTION, eventsFeatures);
		restoreOption(AUDIENCE_OPTION, audienceFeatures);
	}

	test.beforeAll(() => {
		eventsFeatures = readOption(EVENTS_OPTION);
		audienceFeatures = readOption(AUDIENCE_OPTION);

		event = runScript('seed-event.php', 'E2E_SEED', 'free');
		rules = runScript(
			'seed-group-rules.php',
			'E2E_GROUP_RULES',
			`${event.eventDateId}`
		);
	});

	test.afterEach(() => {
		restoreAvailability();
	});

	test.afterAll(() => {
		// The cleanup scripts need both experimental plugins loaded.
		restoreAvailability();
		if (rules) {
			runScript(
				'cleanup-group-rules.php',
				'E2E_GROUP_RULES_CLEANUP',
				`${rules.eventDateId} ${rules.groupId}`
			);
		}
		if (event) {
			runScript(
				'cleanup-event.php',
				'E2E_CLEANUP',
				`${event.eventId} ${event.eventDateId} ${event.venueId || 0}`
			);
		}
	});

	test('loads existing rules when every service is available', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await expectGroupsShowsRules(page, event.eventDateId, rules.groupName);
	});

	test('is not offered without Fair Events Experimental', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		wpCli('plugin deactivate fair-events-experimental');
		await expectGroupsUnavailable(page, event.eventDateId);
	});

	test('is not offered with experimental ticketing off', async ({ page }) => {
		await loginAsAdmin(page);
		turnBundleOff(EVENTS_OPTION, 'ticketing', eventsFeatures);
		await expectGroupsUnavailable(page, event.eventDateId);
	});

	test('is not offered with audience groups off', async ({ page }) => {
		await loginAsAdmin(page);
		turnBundleOff(AUDIENCE_OPTION, 'groups', audienceFeatures);
		await expectGroupsUnavailable(page, event.eventDateId);
	});

	test('existing rules survive the plugin and feature toggling', async ({
		page,
	}) => {
		await loginAsAdmin(page);
		await expectGroupsShowsRules(page, event.eventDateId, rules.groupName);
	});
});
