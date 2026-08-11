import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * E2E coverage for #1414: an organizer adds a second session on a day that
 * already has one in the irregular series editor (via the "Sessions" list's
 * "+ Add session" control, not the calendar toggle), and a participant sees
 * both as separately selectable/purchasable occurrences on the public
 * signup form.
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

test('organizer adds a second session on one day, and a participant can purchase either one separately', async ({
	page,
	browser,
}) => {
	await login(page);
	await page.goto('/wp-admin/admin.php?page=fair-events-all-events');
	await page.waitForFunction(() => window.wp && window.wp.apiFetch);

	const eventPost = await apiFetch(page, {
		path: '/wp/v2/fair_event',
		method: 'POST',
		data: {
			title: `Multi-session day e2e ${Date.now()}`,
			status: 'publish',
		},
	});

	const eventDate = await apiFetch(page, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: {
			title: 'Multi-session day e2e',
			link_type: 'post',
			start_datetime: '2032-05-01 09:00:00',
			end_datetime: '2032-05-01 11:00:00',
		},
	});

	await apiFetch(page, {
		path: `/fair-events/v1/event-dates/${eventDate.id}`,
		method: 'PUT',
		data: { event_id: eventPost.id },
	});

	let signupPageId;
	let visitorContext;

	try {
		// --- Organizer: add a second session on the master's own day, via
		// the irregular series editor's "+ Add session" control. ---
		await page.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${eventDate.id}`
		);

		await page.getByRole('button', { name: 'Turn into a series' }).click();
		await page.getByRole('tab', { name: 'Irregular series' }).click();

		// Only the master's own date group exists yet, so exactly one
		// "+ Add session" control is on screen.
		await page.getByRole('button', { name: '+ Add session' }).click();

		// Give the newly-added session its own, distinct time — independent
		// of the master's 09:00–11:00 session on the same calendar day.
		await page.getByLabel('Session start time').fill('14:00');
		await page.getByLabel('Session end time').fill('16:00');

		await page.getByRole('button', { name: /Create series/ }).click();

		// Modal closes and the card now offers "Edit series" instead of
		// "Turn into a series" — confirms the save round-tripped.
		await expect(
			page.getByRole('button', { name: 'Edit series' })
		).toBeVisible();

		const afterSave = await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}`,
		});
		expect(afterSave.recurrence_mode).toBe('manual');
		expect(afterSave.generated_occurrences).toHaveLength(1);
		expect(afterSave.generated_occurrences[0].start_datetime).toBe(
			'2032-05-01 14:00:00'
		);

		// --- Sell a ticket type and publish a signup page. ---
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'General admission',
						recurrence_scope: 'single_instance',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						group_ids: [],
					},
				],
				sale_periods: [
					{
						name: 'Always on',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 0 },
				],
				settings: {},
			},
		});

		const signupPage = await apiFetch(page, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Multi-session day e2e page ${Date.now()}`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${eventDate.id}} /-->`,
			},
		});
		signupPageId = signupPage.id;

		// --- Participant: both sessions on the shared day are separately
		// selectable in the occurrence picker. ---
		visitorContext = await browser.newContext();
		const visitorPage = await visitorContext.newPage();
		await visitorPage.goto(`/?page_id=${signupPageId}`);

		const options = visitorPage.locator(
			'.fair-events-occurrence-select option'
		);
		await expect(options).toHaveCount(2);

		const labels = await options.allTextContents();
		expect(labels[0].trim()).not.toBe(labels[1].trim());

		const values = await options.evaluateAll((opts) =>
			opts.map((o) => o.value)
		);
		expect(new Set(values).size).toBe(2);
	} finally {
		if (visitorContext) {
			await visitorContext.close();
		}
		if (signupPageId) {
			await apiFetch(page, {
				path: `/wp/v2/pages/${signupPageId}`,
				method: 'DELETE',
				data: { force: true },
			}).catch(() => {});
		}
		await apiFetch(page, {
			path: `/wp/v2/fair_event/${eventPost.id}`,
			method: 'DELETE',
			data: { force: true },
		}).catch(() => {});
		await apiFetch(page, {
			path: `/fair-events/v1/event-dates/${eventDate.id}`,
			method: 'DELETE',
		}).catch(() => {});
	}
});
