/**
 * E2E: Manage Event → Prices warns about sale periods with no tickets on
 * sale (#1840). The warning names the affected period and its dates, goes
 * away as soon as the configuration is corrected (before saving), and stays
 * away after saving and reloading.
 *
 * The browser runs in a timezone far from the site's, so a date shifted by
 * browser-side conversion would show up in the warning's wording.
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			const data = await wp.apiFetch( opts );
			return { ok: true, data };
		} catch ( error ) {
			return {
				ok: false,
				error: { message: error?.message, code: error?.code },
			};
		}
	}, options );

	if ( ! result.ok ) {
		throw new Error(
			`apiFetch ${ options.method || 'GET' } ${
				options.path
			} failed: ${ JSON.stringify( result.error ) }`
		);
	}

	return result.data;
}

async function login( page ) {
	await page.goto( '/wp-admin' );
	if ( page.url().includes( 'wp-login.php' ) ) {
		await page.fill( '#user_login', WP_ADMIN_USER );
		await page.fill( '#user_pass', WP_ADMIN_PASS );
		await page.click( '#wp-submit' );
	}
	await page.waitForSelector( '#wpadminbar' );
}

test.describe( 'Manage Event — sale periods with no tickets on sale', () => {
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	const stamp = Date.now();

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext( {
			locale: 'en-US',
			timezoneId: 'Pacific/Kiritimati',
		} );
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction(
			() => window.wp && window.wp.apiFetch
		);

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: {
				title: `Sale period gaps e2e ${ stamp }`,
				status: 'publish',
			},
		} );
		eventPostId = eventPost.id;

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Sale period gaps e2e ${ stamp }`,
				link_type: 'post',
				start_date: '2036-05-10',
				start_time: '18:00:00',
				end_date: '2036-05-10',
				end_time: '22:00:00',
			},
		} );
		eventDateId = eventDate.id;

		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );

		// "Regular" is priced in the advance period only, so the event-day
		// period has no ticket on sale.
		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'Regular',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
				],
				sale_periods: [
					{
						name: 'Advance ticket',
						sale_start: '2036-05-01 00:00:00',
						sale_end: '2036-05-10 00:00:00',
					},
					{
						name: 'Day of event',
						sale_start: '2036-05-10 00:00:00',
						sale_end: '2036-05-11 00:00:00',
					},
				],
				prices: [
					{
						ticket_type_index: 0,
						sale_period_index: 0,
						price: 10,
					},
				],
				options: [],
				settings: { multiple_pricing_periods: true },
			},
		} );
	} );

	test.afterAll( async () => {
		if ( eventPostId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPostId }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	const openSalePeriods = async () => {
		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=prices`
		);
		await adminPage.getByRole( 'button', { name: 'Sale Periods' } ).click();
		// The calendar legend: the panel is open and the data has loaded.
		await expect(
			adminPage.getByText( 'Event day', { exact: true } )
		).toBeVisible();
	};

	const warning = () =>
		adminPage
			.locator( '.components-notice' )
			.filter( { hasText: 'no tickets on sale' } );
	const legendEntry = () =>
		adminPage.getByText( 'No tickets on sale', { exact: true } );

	test( 'warns about the period, and stops once a ticket is offered in it', async () => {
		await openSalePeriods();

		await expect( warning() ).toContainText(
			'Day of event: no tickets on sale on May 10, 2036.'
		);
		await expect( warning() ).not.toContainText( 'Advance ticket' );
		await expect( legendEntry() ).toBeVisible();

		// Offer "Regular" for free on the event day.
		const eventDayCell = adminPage
			.locator( 'tr', {
				has: adminPage.locator( 'input[value="Regular"]' ),
			} )
			.locator( 'td', {
				has: adminPage.getByRole( 'checkbox', { name: 'Available' } ),
			} )
			.nth( 1 );
		await eventDayCell
			.getByRole( 'checkbox', { name: 'Available' } )
			.check();
		await eventDayCell.locator( 'input[type="number"]' ).fill( '0' );

		// Gone before anything is saved.
		await expect( warning() ).toHaveCount( 0 );
		await expect( legendEntry() ).toHaveCount( 0 );

		await adminPage.getByRole( 'button', { name: 'Save tickets' } ).click();
		await expect(
			adminPage.getByText( 'Tickets saved successfully.' ).first()
		).toBeVisible();

		await openSalePeriods();
		await expect( warning() ).toHaveCount( 0 );
		await expect( legendEntry() ).toHaveCount( 0 );
	} );
} );
