import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

/**
 * E2E coverage for #1393: the Event Signup form's ticket-type selector must
 * only list types that are actually purchasable under the currently active
 * sale period — not every type ever configured for the event date.
 *
 * Covers the three acceptance-criteria scenarios by loading the actual
 * rendered block page:
 *   - all configured types priced for the active period → all shown.
 *   - only one type priced for the active period → only that one shown.
 *   - no sale period active at all → the form is hidden and treated as
 *     temporarily unavailable, not shown with unpriced/selectable types.
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

/**
 * Creates a published event date + page rendering the Event Signup block,
 * with the given tickets payload (ticket_types/sale_periods/prices).
 * Returns the created resource ids for cleanup, plus a ready-to-use
 * visitor Page loaded on the signup page.
 */
async function setUpSignupPage(adminPage, browser, label, ticketsPayload) {
	const eventPost = await apiFetch(adminPage, {
		path: '/wp/v2/fair_event',
		method: 'POST',
		data: {
			title: `${label} ${Date.now()}`,
			status: 'publish',
		},
	});

	const eventDate = await apiFetch(adminPage, {
		path: '/fair-events/v1/event-dates',
		method: 'POST',
		data: {
			title: label,
			link_type: 'post',
			start_datetime: '2036-01-01 10:00:00',
			end_datetime: '2036-01-01 12:00:00',
		},
	});

	await apiFetch(adminPage, {
		path: `/fair-events/v1/event-dates/${eventDate.id}`,
		method: 'PUT',
		data: { event_id: eventPost.id },
	});

	await apiFetch(adminPage, {
		path: `/fair-events/v1/event-dates/${eventDate.id}/tickets`,
		method: 'PUT',
		data: ticketsPayload,
	});

	const signupPage = await apiFetch(adminPage, {
		path: '/wp/v2/pages',
		method: 'POST',
		data: {
			title: `${label} page ${Date.now()}`,
			status: 'publish',
			content: `<!-- wp:fair-events/event-signup {"eventDateId":${eventDate.id}} /-->`,
		},
	});

	const visitorContext = await browser.newContext();
	const visitorPage = await visitorContext.newPage();
	await visitorPage.goto(`/?page_id=${signupPage.id}`);

	return {
		eventPostId: eventPost.id,
		eventDateId: eventDate.id,
		signupPageId: signupPage.id,
		visitorContext,
		visitorPage,
	};
}

async function cleanUp(adminPage, resources) {
	await resources.visitorContext.close();
	await apiFetch(adminPage, {
		path: `/wp/v2/pages/${resources.signupPageId}`,
		method: 'DELETE',
		data: { force: true },
	}).catch(() => {});
	await apiFetch(adminPage, {
		path: `/wp/v2/fair_event/${resources.eventPostId}`,
		method: 'DELETE',
		data: { force: true },
	}).catch(() => {});
	await apiFetch(adminPage, {
		path: `/fair-events/v1/event-dates/${resources.eventDateId}`,
		method: 'DELETE',
	}).catch(() => {});
}

test.describe('Event Signup — hide ticket types outside their active sale period', () => {
	let adminContext;
	let adminPage;

	test.beforeAll(async ({ browser }) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login(adminPage);
		await adminPage.goto('/wp-admin/admin.php?page=fair-events-all-events');
		await adminPage.waitForFunction(() => window.wp && window.wp.apiFetch);
	});

	test.afterAll(async () => {
		await adminContext.close();
	});

	test('all configured types priced for the active period are all shown', async ({
		browser,
	}) => {
		const resources = await setUpSignupPage(
			adminPage,
			browser,
			'All types active e2e',
			{
				ticket_types: [
					{
						name: 'Early bird',
						recurrence_scope: 'single_instance',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						group_ids: [],
					},
					{
						name: 'Regular',
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
				// Free, so this scenario isn't gated by whether a payment
				// connector happens to be configured — it isolates sale-period
				// visibility, covered separately by the payments-unavailable spec.
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 0 },
					{ ticket_type_index: 1, sale_period_index: 0, price: 0 },
				],
				settings: {},
			}
		);

		try {
			const fieldset = resources.visitorPage.locator(
				'.fair-events-ticket-fieldset'
			);
			await expect(fieldset).toBeVisible();
			await expect(
				fieldset.locator('.fair-events-ticket-option')
			).toHaveCount(2);
			await expect(fieldset).toContainText('Early bird');
			await expect(fieldset).toContainText('Regular');
		} finally {
			await cleanUp(adminPage, resources);
		}
	});

	test('only the type priced for the active period is shown', async ({
		browser,
	}) => {
		const resources = await setUpSignupPage(
			adminPage,
			browser,
			'One type active e2e',
			{
				ticket_types: [
					{
						name: 'Early bird',
						recurrence_scope: 'single_instance',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						group_ids: [],
					},
					{
						name: 'Regular',
						recurrence_scope: 'single_instance',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						group_ids: [],
					},
				],
				sale_periods: [
					{
						name: 'Early bird window (closed)',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2020-02-01 00:00:00',
					},
					{
						name: 'Regular window (active)',
						sale_start: '2020-02-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				// Free, so this scenario isn't gated by whether a payment
				// connector happens to be configured.
				prices: [
					// Early bird is only priced for the closed period.
					{ ticket_type_index: 0, sale_period_index: 0, price: 0 },
					// Regular is only priced for the active period.
					{ ticket_type_index: 1, sale_period_index: 1, price: 0 },
				],
				settings: {},
			}
		);

		try {
			const fieldset = resources.visitorPage.locator(
				'.fair-events-ticket-fieldset'
			);
			await expect(fieldset).toBeVisible();
			await expect(
				fieldset.locator('.fair-events-ticket-option')
			).toHaveCount(1);
			await expect(fieldset).toContainText('Regular');
			await expect(fieldset).not.toContainText('Early bird');
		} finally {
			await cleanUp(adminPage, resources);
		}
	});

	test('no active sale period hides the ticket-type section and blocks signup', async ({
		browser,
	}) => {
		const resources = await setUpSignupPage(
			adminPage,
			browser,
			'No period active e2e',
			{
				ticket_types: [
					{
						name: 'Early bird',
						recurrence_scope: 'single_instance',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						group_ids: [],
					},
				],
				// No sale periods configured at all — nothing is ever purchasable.
				sale_periods: [],
				prices: [],
				settings: {},
			}
		);

		try {
			await expect(
				resources.visitorPage.locator('.fair-events-get-tickets-form')
			).toHaveCount(0);
			await expect(
				resources.visitorPage.locator(
					'.message-container.message-error'
				)
			).toContainText('Ticket sales are temporarily unavailable');
		} finally {
			await cleanUp(adminPage, resources);
		}
	});
});
