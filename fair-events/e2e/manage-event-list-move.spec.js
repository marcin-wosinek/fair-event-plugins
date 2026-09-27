/**
 * E2E: on the Manage Event List tab an administrator moves a signup into a
 * full occurrence of its series. The save is refused until a reason is
 * given, then the signup shows as over capacity with that reason (#1532).
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
				error: {
					message: error?.message,
					code: error?.code,
					data: error?.data,
				},
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

test.describe( 'Manage Event — move a signup over capacity', () => {
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let occurrenceIds = [];
	const stamp = Date.now();
	const mover = `Move Tester ${ stamp }`;
	const reason = 'Friend of the organizer';

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
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
			data: { title: `Move e2e ${ stamp }`, status: 'publish' },
		} );
		eventPostId = eventPost.id;

		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Move e2e ${ stamp }`,
				link_type: 'post',
				start_datetime: '2036-03-03 10:00:00',
				end_datetime: '2036-03-03 12:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=2',
			},
		} );
		occurrenceIds = [
			eventDate.id,
			...( eventDate.generated_occurrences || [] ).map( ( o ) => o.id ),
		].sort( ( a, b ) => a - b );
		expect( occurrenceIds ).toHaveLength( 2 );

		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );

		const tickets = await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDate.id }/tickets`,
			method: 'PUT',
			data: {
				capacity: 1,
				ticket_types: [
					{
						name: 'Move e2e admission',
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: 'single_instance',
						group_ids: [],
					},
				],
				sale_periods: [
					{
						name: 'Always available',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [
					{
						ticket_type_index: 0,
						sale_period_index: 0,
						price: 0,
					},
				],
				settings: {},
			},
		} );
		const ticketTypeId = tickets.ticket_types?.[ 0 ]?.id;
		expect( ticketTypeId ).toBeTruthy();

		// The first occurrence is full; the second holds the signup to move.
		const [ first, second ] = occurrenceIds;
		for ( const [ eventDateId, name ] of [
			[ first, `Early Bird ${ stamp }` ],
			[ second, mover ],
		] ) {
			await apiFetch( adminPage, {
				path: '/fair-events/v1/get-tickets',
				method: 'POST',
				data: {
					event_date_id: eventDateId,
					name,
					email: `move-e2e-${ eventDateId }-${ stamp }@example.test`,
					ticket_type_id: ticketTypeId,
					quantity: 1,
				},
			} );
		}
	} );

	test.afterAll( async () => {
		for ( const eventDateId of occurrenceIds ) {
			const signups = await apiFetch( adminPage, {
				path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			} ).catch( () => [] );
			for ( const row of signups ) {
				await apiFetch( adminPage, {
					path: `/fair-events/v1/get-tickets/${ row.id }`,
					method: 'DELETE',
				} ).catch( () => {} );
			}
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

	test( 'moves a signup into a full date once a reason is given', async () => {
		const [ first, second ] = occurrenceIds;

		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ second }&tab=list`
		);
		const row = adminPage.getByRole( 'row', { name: new RegExp( mover ) } );
		await row.getByRole( 'button', { name: 'Move' } ).click();

		const dialog = adminPage.getByRole( 'dialog', {
			name: `Move ${ mover } to another date`,
		} );
		const select = dialog.getByLabel( 'New date' );
		await expect( select.locator( 'option' ) ).toHaveCount( 2 );
		await expect( select.locator( 'option' ).nth( 1 ) ).toHaveText(
			/ — Full$/
		);
		await select.selectOption( String( first ) );
		await dialog.getByRole( 'button', { name: 'Move signup' } ).click();

		await expect( dialog ).toContainText(
			/would have 2 of 1 place taken\./
		);
		const exceed = dialog.getByRole( 'button', {
			name: 'Exceed capacity',
		} );
		await expect( exceed ).toBeDisabled();
		await expect( dialog ).toContainText(
			'Enter a reason to go over capacity.'
		);

		await dialog.getByLabel( 'Reason' ).fill( reason );
		await exceed.click();

		await expect( dialog ).toHaveCount( 0 );
		await expect(
			adminPage.getByRole( 'row', { name: new RegExp( mover ) } )
		).toHaveCount( 0 );

		await adminPage.goto(
			`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ first }&tab=list`
		);
		const moved = adminPage.getByRole( 'row', {
			name: new RegExp( mover ),
		} );
		await expect( moved ).toContainText( 'Confirmed — over capacity' );
		await moved.getByRole( 'button', { name: 'Details' } ).click();
		await expect( moved ).toContainText( `: ${ reason }` );
	} );
} );
