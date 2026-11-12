/**
 * E2E: the Manage Event List tab prints a gate sheet (#2212) — prices that
 * apply at the event start with currency, blank rows for registering people
 * at the gate, unchecked mailing boxes — even before anyone signed up, on
 * desktop, tablet and mobile, without sending a single write request.
 */

import { test, expect } from '@playwright/test';

const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

const VIEWPORTS = {
	desktop: { width: 1280, height: 900 },
	tablet: { width: 768, height: 1024 },
	mobile: { width: 375, height: 812 },
};

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return { ok: false, error: error?.message };
		}
	}, options );
	if ( ! result.ok ) {
		throw new Error(
			`apiFetch ${ options.method || 'GET' } ${ options.path } failed: ${
				result.error
			}`
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

test.describe( 'Manage Event — gate sheet', () => {
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	const title = `Gate Sheet e2e ${ Date.now() }`;

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction(
			() => typeof window.wp?.apiFetch === 'function'
		);

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: { title, status: 'publish' },
		} );
		eventPostId = eventPost.id;
		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title,
				link_type: 'post',
				start_date: '2036-06-20',
				start_time: '18:00:00',
				end_date: '2036-06-20',
				end_time: '23:00:00',
			},
		} );
		eventDateId = eventDate.id;
		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );
		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					{
						name: 'Gate General',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
					{
						name: 'Gate Reduced',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
				],
				sale_periods: [
					{
						name: 'Advance',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2036-06-20 00:00:00',
					},
					{
						name: 'Day of event',
						sale_start: '2036-06-20 00:00:00',
						sale_end: null,
					},
				],
				prices: [
					{ ticket_type_index: 0, sale_period_index: 0, price: 20 },
					{ ticket_type_index: 0, sale_period_index: 1, price: 25 },
					{ ticket_type_index: 1, sale_period_index: 0, price: 12 },
				],
				settings: { multiple_pricing_periods: true },
				options: [ { name: 'Gate Dinner', price: 14.5 } ],
			},
		} );
	} );

	test.afterAll( async () => {
		if ( eventDateId ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( eventPostId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPostId }`,
				method: 'DELETE',
				data: { force: true },
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	for ( const [ name, viewport ] of Object.entries( VIEWPORTS ) ) {
		test( `prints the gate sheet without signups on ${ name }`, async () => {
			await adminPage.setViewportSize( viewport );
			const writes = [];
			const recordWrites = ( request ) => {
				if (
					request.method() !== 'GET' &&
					request.url().includes( 'wp-json' )
				) {
					writes.push( `${ request.method() } ${ request.url() }` );
				}
			};
			adminContext.on( 'request', recordWrites );

			await adminPage.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=list`
			);
			await expect(
				adminPage.getByText( 'No confirmed registrations yet.' )
			).toBeVisible();
			const button = adminPage.getByRole( 'button', {
				name: 'Print gate sheet',
			} );
			await expect( button ).toBeVisible();
			await expect( button ).toBeEnabled();
			await expect(
				adminPage.getByRole( 'button', { name: 'Print list' } )
			).toBeDisabled();
			// The control fits the screen without horizontal scrolling.
			const box = await button.boundingBox();
			expect( box.x + box.width ).toBeLessThanOrEqual( viewport.width );

			const [ preview ] = await Promise.all( [
				adminContext.waitForEvent( 'page' ),
				button.click(),
			] );
			await preview.waitForLoadState();

			await expect( preview.locator( 'h1' ) ).toHaveText( title );
			await expect( preview.locator( '.period' ) ).toContainText(
				'Day of event (applies at the event start)'
			);
			const reference = preview.locator( 'table.reference' ).first();
			await expect( reference ).toContainText( 'Gate General' );
			await expect( reference ).toContainText( '25.00' );
			await expect( reference ).toContainText( 'Price not configured' );
			await expect( preview.locator( '.warning' ) ).toContainText(
				'Do not treat them as free'
			);
			await expect(
				preview.locator( 'table.reference' ).nth( 1 )
			).toContainText( '14.50' );
			await expect( preview.locator( 'table.sheet' ) ).toHaveCount( 2 );
			await expect(
				preview.locator( 'table.sheet' ).first().locator( 'thead th' )
			).toHaveText( [
				'Name',
				'Surname',
				'Email',
				'Mailing opt-in',
				'Ticket type',
				'Extra options',
				'Total',
				'Comments',
			] );
			await expect(
				preview.locator( 'table.sheet tbody tr' )
			).toHaveCount( 20 );
			await expect( preview.locator( 'td .box' ) ).toHaveCount( 20 );
			await expect(
				preview.getByRole( 'button', { name: 'Print' } )
			).toBeVisible();

			await preview.close();
			adminContext.off( 'request', recordWrites );
			expect( writes ).toEqual( [] );
		} );
	}
} );
