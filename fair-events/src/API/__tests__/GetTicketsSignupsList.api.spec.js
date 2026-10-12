/**
 * Playwright API tests for the get-tickets admin signups list (#1346):
 * GetTicketsController::get_items() must embed a resolved ticket_type_name
 * on each signup row, so the admin signups table/CSV export can show the
 * name instead of a meaningless numeric ID.
 *
 * Covers:
 *   - a signup with a valid ticket type gets its name attached.
 *   - a signup whose ticket type has since been deleted gets ticket_type_name
 *     null instead of an error or the stale ID.
 *
 * And the List's membership per date (#1791): a ticket moved on its own is
 * listed on the date it is on, with its purchase, and the purchase total is
 * anchored to the lowest confirmed ticket of the purchase.
 */

import { test, expect, request } from '@playwright/test';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminHeaders = {
	Authorization:
		'Basic ' +
		Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
			'base64'
		),
};

test.describe( 'GetTicketsController — admin signups list ticket_type_name', () => {
	let api;
	let eventPostId;
	let eventDateId;
	let ticketTypeId;
	let signupEmails;
	let signupIds = [];

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets signups list test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Get-tickets signups list test ${ Date.now() }`,
				link_type: 'post',
				start_datetime: '2035-06-01 10:00:00',
				end_datetime: '2035-06-01 12:00:00',
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		eventDateId = ( await edRes.json() ).id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: eventPostId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [
						{
							name: 'General Admission',
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
			}
		);
		expect( ticketsRes.ok() ).toBeTruthy();
		const ticketsBody = await ticketsRes.json();
		ticketTypeId = ticketsBody.ticket_types?.[ 0 ]?.id;
		expect( ticketTypeId ).toBeTruthy();

		signupEmails = {
			checked: `signups-list-checked-${ Date.now() }@example.test`,
			unchecked: `signups-list-unchecked-${ Date.now() }@example.test`,
		};
		const signupResponses = await Promise.all(
			Object.entries( signupEmails ).map( ( [ consent, email ] ) =>
				api.post( '/wp-json/fair-events/v1/get-tickets', {
					data: {
						event_date_id: eventDateId,
						name: `Signups List ${ consent } Tester`,
						email,
						ticket_type_id: ticketTypeId,
						quantity: 1,
						mailing_opt_in: consent === 'checked',
					},
				} )
			)
		);
		expect(
			signupResponses.every( ( response ) => response.ok() )
		).toBeTruthy();
	} );

	test.afterAll( async () => {
		for ( const signupId of signupIds ) {
			await api.delete(
				`/wp-json/fair-events/v1/get-tickets/${ signupId }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'a signup with a valid ticket type gets ticket_type_name resolved', async () => {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();
		const signup = signups.find(
			( s ) => s.email === signupEmails.checked
		);
		expect( signup ).toBeTruthy();
		signupIds = signups.map( ( item ) => item.id );
		expect( signup.ticket_type_name ).toBe( 'General Admission' );
	} );

	test( 'mailing consent persists and is serialized as explicit booleans', async () => {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();
		const checked = signups.find(
			( signup ) => signup.email === signupEmails.checked
		);
		const unchecked = signups.find(
			( signup ) => signup.email === signupEmails.unchecked
		);

		expect( checked?.mailing_opt_in ).toBe( true );
		expect( unchecked?.mailing_opt_in ).toBe( false );
		signupIds = signups.map( ( signup ) => signup.id );
	} );

	test( 'over-capacity values are serialized as explicit booleans', async () => {
		const initialRes = await api.get(
			'/wp-json/fair-events/v1/get-tickets',
			{
				headers: adminHeaders,
				params: { event_date: eventDateId },
			}
		);
		expect( initialRes.ok() ).toBeTruthy();
		const initialSignups = await initialRes.json();
		const cleared = initialSignups.find(
			( signup ) => signup.email === signupEmails.unchecked
		);
		const enabled = initialSignups.find(
			( signup ) => signup.email === signupEmails.checked
		);
		expect( cleared ).toBeTruthy();
		expect( enabled ).toBeTruthy();

		const enableRes = await api.put(
			'/wp-json/fair-e2e/v1/mark-signup-over-capacity',
			{
				headers: adminHeaders,
				data: { signup_id: enabled.id },
			}
		);
		expect( enableRes.ok() ).toBeTruthy();

		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();

		expect(
			signups.find( ( signup ) => signup.id === cleared.id )
				?.over_capacity
		).toBe( false );
		expect(
			signups.find( ( signup ) => signup.id === enabled.id )
				?.over_capacity
		).toBe( true );
		signupIds = signups.map( ( signup ) => signup.id );
	} );

	test( 'a signup referencing a deleted ticket type gets ticket_type_name null', async () => {
		const deleteRes = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets/import`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [],
					sale_periods: [],
					prices: [],
					settings: {},
				},
			}
		);
		expect( deleteRes.ok() ).toBeTruthy();

		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();
		const signup = signups.find(
			( s ) => s.email === signupEmails.checked
		);
		expect( signup ).toBeTruthy();
		expect( signup.ticket_type_name ).toBeNull();
	} );
} );

test.describe( 'GetTicketsController — tickets listed under their own date (#1791)', () => {
	let api;
	let postId;
	let first;
	let second;
	let third;
	let singleId;
	let wholeId;
	const signupIds = new Set();

	const uniqueEmail = ( prefix ) =>
		`${ prefix }-${ Date.now() }-${ Math.floor(
			Math.random() * 1e6
		) }@example.test`;

	async function list( eventDateId ) {
		const res = await api.get( '/wp-json/fair-events/v1/get-tickets', {
			headers: adminHeaders,
			params: { event_date: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
		const signups = await res.json();
		signups.forEach( ( signup ) => signupIds.add( signup.id ) );
		return signups;
	}

	// Each purchase is a separate visitor, so each gets its own participant.
	async function buy( data ) {
		const email = uniqueEmail( 'listed' );
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				name: 'Listed Buyer',
				email,
				_honeypot: '',
				event_date_id: first,
				ticket_type_id: singleId,
				...data,
			},
		} );
		const body = await res.json();
		await visitor.dispose();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		return ( await list( data.event_date_id || first ) ).find(
			( signup ) => signup.email === email
		);
	}

	async function moveTicket( ticketId, eventDateId ) {
		const res = await api.post( '/wp-json/fair-e2e/v1/ticket-units/move', {
			headers: adminHeaders,
			data: { ticket_id: ticketId, event_date_id: eventDateId },
		} );
		expect( res.ok() ).toBeTruthy();
	}

	async function setTicketStatus( signupId, position, status ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/ticket-capacity/unit-status',
			{
				headers: adminHeaders,
				data: { signup_id: signupId, position, status },
			}
		);
		expect( res.ok() ).toBeTruthy();
	}

	const purchaseOn = async ( eventDateId, signupId ) =>
		( await list( eventDateId ) ).find(
			( signup ) => signup.id === signupId
		);

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const title = `Listed tickets ${ Date.now() }`;

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		postId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_datetime: '2035-06-10 19:00:00',
				end_datetime: '2035-06-10 22:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		[ first, second, third ] = [
			edBody.id,
			...( edBody.generated_occurrences || [] ).map( ( o ) => o.id ),
		].sort( ( a, b ) => a - b );

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const scopes = [ 'single_instance', 'whole_series' ];
		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: scopes.map( ( scope ) => ( {
						name: scope,
						capacity: null,
						minimum_activities: 0,
						disable_at: null,
						recurrence_scope: scope,
						minimum_instances: 1,
						group_ids: [],
					} ) ),
					sale_periods: [
						{
							name: 'Always on',
							sale_start: '2020-01-01 00:00:00',
							sale_end: '2099-01-01 00:00:00',
						},
					],
					prices: scopes.map( ( scope, index ) => ( {
						ticket_type_index: index,
						sale_period_index: 0,
						price: 0,
					} ) ),
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();
		[ singleId, wholeId ] = ticketsBody.ticket_types.map(
			( type ) => type.id
		);
	} );

	test.afterAll( async () => {
		for ( const signupId of signupIds ) {
			await api.delete(
				`/wp-json/fair-events/v1/get-tickets/${ signupId }`,
				{ headers: adminHeaders }
			);
		}
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'an unmoved purchase is listed on its own date only, as before', async () => {
		const signup = await buy( { quantity: 2 } );
		const ids = signup.tickets.map( ( ticket ) => ticket.id );

		expect( signup.listed_ticket_ids ).toEqual( ids );
		expect( signup.accounting_anchor_ticket_id ).toBe( ids[ 0 ] );
		expect( signup.ticket_counts ).toEqual( {
			confirmed: 2,
			on_this_date: 2,
			on_other_dates: 0,
			on_registration_date: 2,
			inactive: 0,
		} );
		expect( signup.tickets.map( ( t ) => t.event_date_id ) ).toEqual( [
			first,
			first,
		] );
		expect( await purchaseOn( second, signup.id ) ).toBeUndefined();
	} );

	test( 'a ticket moved on its own is listed on its new date, with its purchase', async () => {
		const signup = await buy( { quantity: 2 } );
		const [ kept, moved ] = signup.tickets;
		await moveTicket( moved.id, second );

		const original = await purchaseOn( first, signup.id );
		expect( original.listed_ticket_ids ).toEqual( [ kept.id ] );
		expect( original.ticket_counts ).toMatchObject( {
			confirmed: 2,
			on_this_date: 1,
			on_other_dates: 1,
			on_registration_date: 1,
		} );

		const target = await purchaseOn( second, signup.id );
		expect( target ).toBeTruthy();
		expect( target.listed_ticket_ids ).toEqual( [ moved.id ] );
		expect( Number( target.event_date_id ) ).toBe( first );
		expect( target.event_date_label ).toBeTruthy();
		expect( target.name ).toBe( 'Listed Buyer' );
		expect( target.can_move ).toBe( true );
		// The whole purchase stays available for purchase-wide actions.
		expect( target.tickets.map( ( t ) => t.id ) ).toEqual( [
			kept.id,
			moved.id,
		] );
		expect( target.tickets[ 1 ] ).toMatchObject( {
			id: moved.id,
			position: 2,
			reference: moved.reference,
			ticket_type_id: singleId,
			ticket_type_name: 'single_instance',
			event_date_id: second,
			status: 'confirmed',
			attended_at: moved.attended_at,
			confirmed_activity_ids: moved.confirmed_activity_ids,
		} );
		// The total stays with the lowest confirmed ticket, on the original date.
		expect( original.accounting_anchor_ticket_id ).toBe( kept.id );
		expect( target.accounting_anchor_ticket_id ).toBe( kept.id );

		expect( await purchaseOn( third, signup.id ) ).toBeUndefined();
	} );

	test( 'a purchase whose tickets all moved has no listed ticket on its date and takes its total along', async () => {
		const signup = await buy( { quantity: 2 } );
		const ids = signup.tickets.map( ( ticket ) => ticket.id );
		await moveTicket( ids[ 0 ], second );
		await moveTicket( ids[ 1 ], third );

		// Still returned for its own date, so the List can tell it apart
		// from a registration whose tickets were never created.
		const original = await purchaseOn( first, signup.id );
		expect( original.listed_ticket_ids ).toEqual( [] );
		expect( original.tickets ).toHaveLength( 2 );
		expect( original.ticket_counts ).toMatchObject( {
			on_this_date: 0,
			on_other_dates: 2,
			on_registration_date: 0,
		} );

		const onSecond = await purchaseOn( second, signup.id );
		expect( onSecond.listed_ticket_ids ).toEqual( [ ids[ 0 ] ] );
		expect( onSecond.accounting_anchor_ticket_id ).toBe( ids[ 0 ] );
		const onThird = await purchaseOn( third, signup.id );
		expect( onThird.listed_ticket_ids ).toEqual( [ ids[ 1 ] ] );
		expect( onThird.accounting_anchor_ticket_id ).toBe( ids[ 0 ] );
	} );

	test( 'cancelling the anchor gives the total to the next confirmed ticket, and none when no ticket is left', async () => {
		const signup = await buy( { quantity: 2 } );
		const ids = signup.tickets.map( ( ticket ) => ticket.id );
		await moveTicket( ids[ 1 ], second );
		await setTicketStatus( signup.id, 1, 'cancelled' );

		const original = await purchaseOn( first, signup.id );
		expect( original.listed_ticket_ids ).toEqual( [] );
		expect( original.accounting_anchor_ticket_id ).toBe( ids[ 1 ] );
		expect( original.ticket_counts ).toMatchObject( {
			confirmed: 1,
			inactive: 1,
		} );
		const target = await purchaseOn( second, signup.id );
		expect( target.listed_ticket_ids ).toEqual( [ ids[ 1 ] ] );
		expect( target.accounting_anchor_ticket_id ).toBe( ids[ 1 ] );

		await setTicketStatus( signup.id, 2, 'cancelled' );
		expect( await purchaseOn( second, signup.id ) ).toBeUndefined();
		const emptied = await purchaseOn( first, signup.id );
		expect( emptied.listed_ticket_ids ).toEqual( [] );
		expect( emptied.accounting_anchor_ticket_id ).toBeNull();
	} );

	test( 'a whole-series pass stays listed where it was bought, with all its tickets', async () => {
		const signup = await buy( { ticket_type_id: wholeId, quantity: 2 } );
		const ids = signup.tickets.map( ( ticket ) => ticket.id );
		expect( signup.recurrence_scope ).toBe( 'whole_series' );
		// Not reachable through the UI: a pass cannot be moved.
		await moveTicket( ids[ 1 ], second );

		const original = await purchaseOn( first, signup.id );
		expect( original.listed_ticket_ids ).toEqual( ids );
		expect( original.accounting_anchor_ticket_id ).toBe( ids[ 0 ] );
		expect( await purchaseOn( second, signup.id ) ).toBeUndefined();
	} );

	test( 'a registration without tickets keeps its single row on its own date', async () => {
		const email = uniqueEmail( 'legacy' );
		const seeded = await api.post(
			'/wp-json/fair-e2e/v1/ticket-units/legacy-signups',
			{
				headers: adminHeaders,
				data: {
					event_date_id: third,
					email,
					signups: [ { quantity: 2 } ],
				},
			}
		);
		expect( seeded.ok() ).toBeTruthy();

		const legacy = ( await list( third ) ).find(
			( signup ) => signup.email === email
		);
		expect( legacy.tickets ).toEqual( [] );
		expect( legacy.listed_ticket_ids ).toEqual( [] );
		expect( legacy.accounting_anchor_ticket_id ).toBeNull();
		expect(
			( await list( first ) ).some( ( signup ) => signup.email === email )
		).toBe( false );
	} );
} );
