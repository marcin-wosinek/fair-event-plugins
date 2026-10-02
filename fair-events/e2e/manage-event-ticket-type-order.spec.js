/**
 * E2E: an organizer moves a ticket type to the top in the Tickets editor
 * (#1757). The row moves immediately, the order is kept after Save tickets
 * and a reload, the signup form offers the ticket choices in that order, and
 * an earlier signup stays on the type it bought.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8889';
const WP_ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const WP_ADMIN_PASS = process.env.WP_ADMIN_PASS || 'password';

async function apiFetch( page, options ) {
	const result = await page.evaluate( async ( opts ) => {
		try {
			// eslint-disable-next-line no-undef
			return { ok: true, data: await wp.apiFetch( opts ) };
		} catch ( error ) {
			return {
				ok: false,
				error: { code: error?.code, message: error?.message },
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

test.describe( 'Manage Event — move a ticket type to the top', () => {
	test.setTimeout( 90_000 );

	let adminContext;
	let adminPage;
	let eventPostId;
	let eventDateId;
	let signupPageId;
	let supporterId;
	const stamp = Date.now();
	const buyerEmail = `ticket-order-e2e-${ stamp }@example.test`;

	test.beforeAll( async ( { browser } ) => {
		adminContext = await browser.newContext();
		adminPage = await adminContext.newPage();
		await login( adminPage );
		await adminPage.goto(
			'/wp-admin/admin.php?page=fair-events-all-events'
		);
		await adminPage.waitForFunction( () => window.wp?.apiFetch );

		const eventPost = await apiFetch( adminPage, {
			path: '/wp/v2/fair_event',
			method: 'POST',
			data: { title: `Ticket order e2e ${ stamp }`, status: 'publish' },
		} );
		eventPostId = eventPost.id;
		const eventDate = await apiFetch( adminPage, {
			path: '/fair-events/v1/event-dates',
			method: 'POST',
			data: {
				title: `Ticket order e2e ${ stamp }`,
				link_type: 'post',
				start_datetime: '2039-03-03 10:00:00',
				end_datetime: '2039-03-03 12:00:00',
			},
		} );
		eventDateId = eventDate.id;
		await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }`,
			method: 'PUT',
			data: { event_id: eventPostId },
		} );

		const ticketType = ( name ) => ( {
			name,
			capacity: null,
			activities_enabled: true,
			minimum_activities: 0,
			maximum_activities: null,
			recurrence_scope: 'single_instance',
			group_ids: [],
		} );
		const tickets = await apiFetch( adminPage, {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			method: 'PUT',
			data: {
				ticket_types: [
					ticketType( 'Standard' ),
					ticketType( 'Student' ),
					ticketType( 'Supporter' ),
				],
				sale_periods: [
					{
						name: 'Always',
						sale_start: '2020-01-01 00:00:00',
						sale_end: '2099-01-01 00:00:00',
					},
				],
				prices: [ 0, 1, 2 ].map( ( index ) => ( {
					ticket_type_index: index,
					sale_period_index: 0,
					price: 0,
				} ) ),
				options: [],
				settings: {},
			},
		} );
		supporterId = tickets.ticket_types[ 2 ].id;

		// An earlier signup on the type that is about to move, bought as an
		// anonymous visitor.
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const buyRes = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					_honeypot: '',
					event_date_id: eventDateId,
					name: `Ticket order ${ stamp }`,
					email: buyerEmail,
					ticket_type_id: supporterId,
				},
			}
		);
		const buyBody = await buyRes.json();
		await visitor.dispose();
		expect( buyRes.status(), JSON.stringify( buyBody ) ).toBe( 200 );

		const signupPage = await apiFetch( adminPage, {
			path: '/wp/v2/pages',
			method: 'POST',
			data: {
				title: `Ticket order page ${ stamp }`,
				status: 'publish',
				content: `<!-- wp:fair-events/event-signup {"eventDateId":${ eventDateId }} /-->`,
			},
		} );
		signupPageId = signupPage.id;
	} );

	test.afterAll( async () => {
		const signups = await apiFetch( adminPage, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} ).catch( () => [] );
		for ( const row of signups ) {
			await apiFetch( adminPage, {
				path: `/fair-events/v1/get-tickets/${ row.id }`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( signupPageId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/pages/${ signupPageId }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		if ( eventPostId ) {
			await apiFetch( adminPage, {
				path: `/wp/v2/fair_event/${ eventPostId }?force=true`,
				method: 'DELETE',
			} ).catch( () => {} );
		}
		await adminContext?.close();
	} );

	test( 'the new order is saved and used by the signup ticket choices', async ( {
		browser,
	} ) => {
		const openEditor = () =>
			adminPage.goto(
				`/wp-admin/admin.php?page=fair-events-manage-event&event_date_id=${ eventDateId }&tab=prices`
			);
		const typeNames = () =>
			adminPage
				.getByPlaceholder( 'Type name' )
				.evaluateAll( ( inputs ) => inputs.map( ( i ) => i.value ) );
		const rowOf = ( name ) =>
			adminPage.getByRole( 'row' ).filter( {
				has: adminPage.locator(
					`input[placeholder="Type name"][value="${ name }"]`
				),
			} );
		const moveToTop = ( name ) =>
			rowOf( name ).getByRole( 'button', { name: 'Move to top' } );

		await openEditor();
		await expect
			.poll( typeNames )
			.toEqual( [ 'Standard', 'Student', 'Supporter' ] );

		// Every type but the first can be moved.
		await expect( moveToTop( 'Standard' ) ).toHaveCount( 0 );
		await expect( moveToTop( 'Student' ) ).toBeVisible();

		await moveToTop( 'Supporter' ).click();
		await expect
			.poll( typeNames )
			.toEqual( [ 'Supporter', 'Standard', 'Student' ] );
		await expect( moveToTop( 'Supporter' ) ).toHaveCount( 0 );

		await adminPage.getByRole( 'button', { name: 'Save tickets' } ).click();
		await expect(
			adminPage
				.locator( '.components-notice' )
				.getByText( 'Tickets saved successfully.' )
		).toBeVisible();

		await adminPage.reload();
		await expect
			.poll( typeNames )
			.toEqual( [ 'Supporter', 'Standard', 'Student' ] );

		// The signup form offers the ticket choices in the saved order.
		const visitor = await browser.newContext();
		const page = await visitor.newPage();
		await page.goto( `/?page_id=${ signupPageId }` );
		const choices = page.locator(
			'.fair-events-get-tickets-form label.fair-events-ticket-option'
		);
		await expect( choices ).toHaveText( [
			/Supporter/,
			/Standard/,
			/Student/,
		] );
		await visitor.close();

		// The earlier signup is still on the type it bought.
		const signups = await apiFetch( adminPage, {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} );
		const earlier = signups.find( ( row ) => row.email === buyerEmail );
		expect( Number( earlier.ticket_type_id ) ).toBe(
			Number( supporterId )
		);
		expect( earlier.ticket_type_name ).toBe( 'Supporter' );
	} );
} );
