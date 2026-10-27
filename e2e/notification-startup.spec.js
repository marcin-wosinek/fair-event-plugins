/**
 * E2E: event notification startup waits for WordPress (#2059).
 *
 * Taking notifications over from their former owners, upgrading their data
 * and scheduling the history cleanup used to run on `plugins_loaded`, before
 * Action Scheduler and translations were set up. An integration observing
 * option updates and translated `cron_schedules` labels then warned on every
 * WP-CLI command.
 *
 * fair-e2e-notification-startup.php stands in for those integrations, loads
 * before every plugin and logs each request's startup on its own. The spec
 * seeds the notification data an earlier release left behind with one
 * WP-CLI run, then starts WordPress in a separate WP-CLI, page or WP-Cron
 * request and checks that startup raised no notice from notification code,
 * finished the takeover once, kept the settings, history and delivery
 * claims, sent nothing, and left the workers and the Telegram connector in
 * place. A request that finds another one migrating leaves the work to it.
 *
 * Remote requests are refused and mail is captured throughout, so nothing
 * leaves the host.
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@playwright/test';
import {
	ADMIN_PASSWORD,
	ADMIN_USER,
	wpCli,
	runScript,
} from './support/wp-cli.js';

const SCRIPT = 'notification-startup-fixture.php';

function fixture(args) {
	return runScript(SCRIPT, 'E2E_NOTIFICATION_STARTUP', args);
}

// A fresh WP-CLI process: WordPress starts up for this command alone.
function cliStartup() {
	wpCli('eval "echo 1;"');
	return lastEntry('cli');
}

async function httpStartup(request, path = '/') {
	const response = await request.get(path);
	expect(response.status()).toBeLessThan(500);
	return lastEntry(path.startsWith('/wp-cron.php') ? 'cron' : 'http');
}

function lastEntry(context) {
	const entries = fixture('state').log.filter(
		(entry) => entry.context === context
	);
	expect(entries.length).toBeGreaterThan(0);
	return entries.at(-1);
}

// No notice raised from notification code, and everything in place once
// WordPress finished loading.
function expectQuietStartup(entry) {
	expect(entry.diagnostics.filter((notice) => notice.notifications)).toEqual(
		[]
	);
	expect(entry.stages).toMatchObject({
		cleanup_handler: true,
		individual_email_worker: true,
		schedule_label: 'Every two weeks',
	});
	// The connector setting is registered exactly while Fair Events runs
	// Telegram, on `init` before core's own connector settings.
	expect(entry.stages.telegram_setting).toBe(entry.stages.telegram_owned);
	if (entry.stages.telegram_connector !== null) {
		expect(entry.stages.telegram_connector).toBe(
			entry.stages.telegram_owned
		);
	}
}

function expectComplete(state) {
	expect(state.markers).toMatchObject({
		deliveries: true,
		configuration: true,
		tables: true,
		history: true,
	});
	expect(state.cleanupEvents).toBe(1);
	expect(state.duplicateCron).toEqual([]);
	expect(state.imported).toBe(1);
	expect(state.lockFree).toBe(true);
}

test.describe('Event notification startup (#2059)', () => {
	test.describe.configure({ mode: 'serial' });

	let before;

	test.beforeAll(() => {
		fixture('enable');
	});

	test.afterAll(() => {
		fixture('disable');
	});

	test('fresh installation takes over once from a WP-CLI startup', () => {
		const seeded = fixture('reset fresh');
		expect(seeded.seeded).toBe(true);
		before = fixture('state');
		expect(before.markers.ownership).toBe(false);

		const entry = cliStartup();
		expectQuietStartup(entry);
		const after = fixture('state');
		expectComplete(after);
		expect(after.markers.telegram).toBe(true);
		expect(after.markers.bulkEmail).toBe(true);
		expect(after.settings).toBe(before.settings);
		expect(after.claims).toBeGreaterThanOrEqual(before.claims);
		// Taking over sends nothing.
		expect(after.mail).toBe(before.mail);
		expect(after.telegram).toBe(before.telegram);
		before = after;

		// A second startup finds nothing left to do.
		const repeated = cliStartup();
		expectQuietStartup(repeated);
		expect(repeated.writes).toEqual([]);
		const again = fixture('state');
		expectComplete(again);
		expect(again.importedTotal).toBe(after.importedTotal);
		expect(again.claims).toBe(after.claims);
	});

	test('a pending upgrade completes in a page request', async ({
		request,
	}) => {
		fixture('reset pending');
		before = fixture('state');
		expect(before.markers.configuration).toBe(false);

		expectQuietStartup(await httpStartup(request));
		const after = fixture('state');
		expectComplete(after);
		expect(after.markers.ownership).toEqual(before.markers.ownership);
		expect(after.settings).toBe(before.settings);
		expect(after.claims).toBe(before.claims);
		expect(after.importedTotal).toBe(before.importedTotal);
		expect(after.mail).toBe(before.mail);
		expect(after.telegram).toBe(before.telegram);

		// Both notification controllers answer administrators.
		const headers = {
			Authorization:
				'Basic ' +
				Buffer.from(`${ADMIN_USER}:${ADMIN_PASSWORD}`).toString(
					'base64'
				),
		};
		for (const path of ['', '/executions']) {
			const response = await request.get(
				`/wp-json/fair-events/v1/event-notifications${path}`,
				{ headers }
			);
			expect(response.status()).toBe(200);
		}
	});

	test('an interrupted import resumes without duplicating history', () => {
		fixture('reset interrupted');
		before = fixture('state');
		expect(before.markers.history).toBe(false);
		expect(before.imported).toBe(1);

		expectQuietStartup(cliStartup());
		expectQuietStartup(cliStartup());
		const after = fixture('state');
		expectComplete(after);
		expect(after.importedTotal).toBe(before.importedTotal);
		expect(after.claims).toBe(before.claims);
		expect(after.settings).toBe(before.settings);
		expect(after.markers.ownership).toEqual(before.markers.ownership);
		expect(after.mail).toBe(before.mail);
	});

	test('WP-Cron starts up quietly and runs the history cleanup', async ({
		request,
	}) => {
		expect(fixture('due-cleanup').due).toBe(true);
		before = fixture('state');

		const entry = await httpStartup(request, '/wp-cron.php');
		expectQuietStartup(entry);
		expect(entry.cleanup_ran).toBe(true);
		const after = fixture('state');
		expectComplete(after);
		expect(after.mail).toBe(before.mail);
		expect(after.telegram).toBe(before.telegram);
	});

	test('a startup that finds the migration running leaves it alone', async ({
		request,
	}) => {
		test.setTimeout(120_000);
		const holder = spawn(
			'npx',
			[
				'wp-env',
				'run',
				'tests-cli',
				'wp',
				'eval-file',
				`wp-content/mu-plugins/scripts/${SCRIPT}`,
				'hold-lock',
				'30',
			],
			{
				cwd: fileURLToPath(new URL('../', import.meta.url)),
				stdio: 'ignore',
			}
		);
		const finished = new Promise((resolve) => holder.on('exit', resolve));

		try {
			await expect
				.poll(
					() =>
						wpCli(
							'option get fair_e2e_notification_startup_lock_held',
							{ allowFailure: true }
						).trim(),
					{ timeout: 60_000 }
				)
				.toBe('1');
			before = fixture('state');
			expect(before.markers.configuration).toBe(false);
			expect(before.lockFree).toBe(false);

			const waiting = await httpStartup(request);
			expect(
				waiting.diagnostics.filter((notice) => notice.notifications)
			).toEqual([]);
			// Not upgraded yet, so its worker waits; nothing else is touched.
			expect(waiting.stages.individual_email_worker).toBe(false);
			expect(waiting.stages.cleanup_handler).toBe(true);
			expect(waiting.writes).toEqual([]);
			const during = fixture('state');
			expect(during.markers.configuration).toBe(false);
			expect(during.settings).toBe(before.settings);
		} finally {
			await finished;
		}

		expectQuietStartup(await httpStartup(request));
		const after = fixture('state');
		expectComplete(after);
		expect(after.settings).toBe(before.settings);
		expect(after.claims).toBe(before.claims);
		expect(after.importedTotal).toBe(before.importedTotal);
		expect(after.mail).toBe(before.mail);
		expect(after.telegram).toBe(before.telegram);
	});
});
