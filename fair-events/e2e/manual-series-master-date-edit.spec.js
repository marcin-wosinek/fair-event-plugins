import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * Regression for #979: editing an irregular (manual) series' master event
 * only through its own start_datetime — the "Event Details" start-date field,
 * not the "Edit series" modal — used to fall into the rrule-regenerate path
 * in EventDatesController::update_item(), which treated the manual master's
 * null rrule as "series ended" and wiped every hand-picked date.
 *
 * Also covers #1414: each session now carries its own independent
 * start/end, so editing only the master's own time must NOT reflow onto its
 * sibling sessions (the old date-only model applied the master's new
 * time-of-day to every date; the new model leaves siblings untouched).
 */

async function apiFetch(page, options) {
	const result = await page.evaluate(async (opts) => {
		try {
			// eslint-disable-next-line no-undef
			const res = await wp.apiFetch(opts);
			return { ok: true, data: res };
		} catch (err) {
			return {
				ok: false,
				error: {
					message: err && err.message,
					code: err && err.code,
					data: err && err.data,
				},
			};
		}
	}, options);
	if (!result.ok) {
		throw new Error(
			`apiFetch ${options.method || 'GET'} ${
				options.path
			} failed: ${JSON.stringify(result.error)}`
		);
	}
	return result.data;
}

async function login(page) {
	await page.goto('/wp-admin');
	if (page.url().includes('wp-login.php')) {
		await page.fill('#user_login', WP_ADMIN_USER);
		await page.fill('#user_pass', WP_ADMIN_PASS);
		await page.click('#wp-submit');
	}
	await page.waitForSelector('#wpadminbar');
}

test.describe('Manual (irregular) series survives editing the master date', () => {
	test('PUT with only start_datetime keeps recurrence_mode=manual and leaves sibling sessions untouched', async ({
		page,
	}) => {
		await login(page);
		await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await page.waitForFunction(() => window.wp && window.wp.apiFetch);

		const master = await apiFetch(page, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: 'Manual series master-date-edit regression',
				start_datetime: '2026-08-01 18:00:00',
				end_datetime: '2026-08-01 20:00:00',
				all_day: false,
			},
		});

		try {
			await apiFetch(page, {
				path: `/fair-events/v1/event-dates/${master.id}`,
				method: 'PUT',
				data: {
					recurrence_mode: 'manual',
					manual_sessions: [
						{
							id: master.id,
							start_datetime: '2026-08-01 18:00:00',
							end_datetime: '2026-08-01 20:00:00',
						},
						{
							id: null,
							start_datetime: '2026-08-15 18:00:00',
							end_datetime: '2026-08-15 20:00:00',
						},
						{
							id: null,
							start_datetime: '2026-09-01 18:00:00',
							end_datetime: '2026-09-01 20:00:00',
						},
					],
				},
			});

			const afterCreate = await apiFetch(page, {
				path: `/fair-events/v1/event-dates/${master.id}`,
			});
			expect(afterCreate.recurrence_mode).toBe('manual');
			expect(afterCreate.generated_occurrences).toHaveLength(2);

			// Edit only the master's own start/end time — what the Event
			// Details start-date field sends — with no rrule/manual_sessions.
			await apiFetch(page, {
				path: `/fair-events/v1/event-dates/${master.id}`,
				method: 'PUT',
				data: {
					start_datetime: '2026-08-01 19:00:00',
					end_datetime: '2026-08-01 21:00:00',
				},
			});

			const afterEdit = await apiFetch(page, {
				path: `/fair-events/v1/event-dates/${master.id}`,
			});

			expect(afterEdit.recurrence_mode).toBe('manual');
			expect(afterEdit.occurrence_type).toBe('master');
			expect(afterEdit.start_datetime).toBe('2026-08-01 19:00:00');
			expect(afterEdit.generated_occurrences).toHaveLength(2);

			// Each session carries its own independent time (#1414) — editing
			// only the master's own time must not reflow onto its siblings,
			// which keep their originally-set 18:00 start.
			const dates = afterEdit.generated_occurrences
				.map((occ) => occ.start_datetime)
				.sort();
			expect(dates).toEqual([
				'2026-08-15 18:00:00',
				'2026-09-01 18:00:00',
			]);
		} finally {
			await apiFetch(page, {
				path: `/fair-events/v1/event-dates/${master.id}`,
				method: 'DELETE',
			}).catch(() => {});
		}
	});
});
