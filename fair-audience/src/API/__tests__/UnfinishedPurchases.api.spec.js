/**
 * Playwright API tests for purchases that are not paid yet, or never are
 * (#1754).
 *
 * Purchases go through the public fair-events/v1/get-tickets route against
 * the Mollie double from e2e/mu-plugins. Payment notifications, lapsed holds
 * and the expiry cleanups are driven through the test-only fair-e2e/v1
 * routes. Each step reads both rosters: the fair-events registrations the
 * List tab filters to confirmed ones, and the fair-audience participants of
 * the Audience tab.
 */

import { randomUUID } from 'node:crypto';
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

const run = `${ Date.now() }-${ Math.random().toString( 36 ).slice( 2 ) }`;

test.describe.serial( 'Purchases awaiting payment and the rosters', () => {
	let api;
	let postId;
	let eventDateId;
	let paidId;
	let freeId;
	const buyers = {};

	// One buyer: their own browser, recognised by the session cookie their
	// first purchase sets.
	async function buyer( key ) {
		if ( ! buyers[ key ] ) {
			buyers[ key ] = {
				name: `${ key } Buyer`,
				email: `unfinished-${ key }-${ run }@example.test`,
				browser: await request.newContext( { baseURL: BASE_URL } ),
			};
		}
		return buyers[ key ];
	}

	async function buy( key, ticketTypeId, quantity = 1 ) {
		const who = await buyer( key );
		const res = await who.browser.post(
			'/wp-json/fair-events/v1/get-tickets',
			{
				data: {
					event_date_id: eventDateId,
					ticket_type_id: ticketTypeId,
					name: who.name,
					email: who.email,
					quantity,
					idempotency_key: randomUUID(),
					_honeypot: '',
				},
			}
		);
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		return body;
	}

	// The buyer's registrations, oldest first, as the List tab receives them.
	async function registrations( key ) {
		const who = await buyer( key );
		const res = await api.get(
			`/wp-json/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() )
			.filter( ( row ) => row.email === who.email )
			.sort( ( a, b ) => a.id - b.id );
	}

	// What the List tab shows of them: confirmed tickets of confirmed
	// registrations.
	async function listed( key ) {
		return ( await registrations( key ) )
			.filter( ( row ) => row.status === 'confirmed' )
			.flatMap( ( row ) =>
				row.tickets.filter( ( t ) => t.status === 'confirmed' )
			)
			.map( ( t ) => t.id );
	}

	// The buyer's row in the Audience tab, or undefined.
	async function audience( key ) {
		const who = await buyer( key );
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).find(
			( row ) => row.participant_email === who.email
		);
	}

	async function fixture( path, data ) {
		const res = await api.post( `/wp-json/fair-e2e/v1/${ path }`, {
			headers: adminHeaders,
			data,
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	}

	const pay = ( signupId ) =>
		fixture( 'ticket-capacity/pay', { signup_id: signupId } );
	const fail = ( signupId ) =>
		fixture( 'ticket-capacity/fail', { signup_id: signupId } );
	const expire = ( signupId ) =>
		fixture( 'ticket-units/transition', {
			signup_id: signupId,
			action: 'expire',
		} );
	const expireAudienceHold = ( participantId ) =>
		fixture( 'ticket-capacity/expire-audience-hold', {
			event_date_id: eventDateId,
			participant_id: participantId,
		} );

	async function setMollieStatus( status ) {
		const res = await api.put( '/wp-json/fair-e2e/v1/mollie-status', {
			headers: adminHeaders,
			data: { status },
		} );
		expect( res.ok() ).toBeTruthy();
	}

	async function setRole( participantId, data ) {
		const res = await api.put(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants/${ participantId }`,
			{ headers: adminHeaders, data }
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	}

	async function ticketAction( ticketId, action, data = {} ) {
		const res = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketId }/${ action }`,
			{ headers: adminHeaders, data }
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const title = `Unfinished purchases ${ run }`;
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
				start_datetime: '2035-11-06 10:00:00',
				end_datetime: '2035-11-06 12:00:00',
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		eventDateId = edBody.id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const type = ( name ) => ( {
			name,
			capacity: null,
			minimum_activities: 0,
			disable_at: null,
			recurrence_scope: 'single_instance',
			minimum_instances: 1,
			group_ids: [],
		} );
		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [ type( 'Paid' ), type( 'Free' ) ],
					sale_periods: [
						{
							name: 'Always on',
							sale_start: '2020-01-01 00:00:00',
							sale_end: '2099-01-01 00:00:00',
						},
					],
					prices: [
						{
							ticket_type_index: 0,
							sale_period_index: 0,
							price: 15,
						},
						{
							ticket_type_index: 1,
							sale_period_index: 0,
							price: 0,
						},
					],
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();
		[ paidId, freeId ] = ticketsBody.ticket_types.map(
			( ticketType ) => ticketType.id
		);
	} );

	test.afterAll( async () => {
		// Every other spec expects the double to report a paid payment.
		await setMollieStatus( 'paid' );

		const participantIds = new Set();
		for ( const key of Object.keys( buyers ) ) {
			for ( const signup of await registrations( key ) ) {
				if ( signup.participant_id ) {
					participantIds.add( Number( signup.participant_id ) );
				}
				await api.delete(
					`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
					{ headers: adminHeaders }
				);
			}
			await buyers[ key ].browser.dispose();
		}
		for ( const participantId of participantIds ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ participantId }`,
				{ headers: adminHeaders }
			);
		}
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		await api.dispose();
	} );

	test( 'starting a paid purchase lists nobody, and names the payment as in progress', async () => {
		const started = await buy( 'Paula', paidId, 2 );
		expect( started.status ).toBe( 'payment_required' );

		const [ signup ] = await registrations( 'Paula' );
		expect( signup.status ).toBe( 'pending_payment' );
		expect( signup.tickets.map( ( t ) => t.status ) ).toEqual( [
			'pending_payment',
			'pending_payment',
		] );
		expect( await listed( 'Paula' ) ).toEqual( [] );

		const row = await audience( 'Paula' );
		expect( row.label ).toBe( 'pending_payment' );
		expect( row.payment_in_progress ).toBe( true );
	} );

	test( 'saving other details of someone paying does not register them', async () => {
		const row = await audience( 'Paula' );
		const saved = await setRole( row.participant_id, {
			admin_comment: 'Asked about parking',
		} );
		expect( saved.label ).toBe( 'pending_payment' );

		const after = await audience( 'Paula' );
		expect( after.label ).toBe( 'pending_payment' );
		expect( after.admin_comment ).toBe( 'Asked about parking' );
		expect( await listed( 'Paula' ) ).toEqual( [] );
	} );

	test( 'a failed payment grants no ticket and is no longer in progress', async () => {
		const [ signup ] = await registrations( 'Paula' );
		await fail( signup.id );
		// The same notification again changes nothing.
		await fail( signup.id );

		const [ failed ] = await registrations( 'Paula' );
		expect( failed.status ).toBe( 'failed' );
		expect( failed.tickets.map( ( t ) => t.status ) ).toEqual( [
			'failed',
			'failed',
		] );
		expect( await listed( 'Paula' ) ).toEqual( [] );

		const row = await audience( 'Paula' );
		expect( row.label ).toBe( 'pending_payment' );
		expect( row.payment_in_progress ).toBe( false );
		expect( row.tickets ).toEqual( [] );
	} );

	test( 'a verified payment arriving after the failure still confirms the purchase', async () => {
		const [ signup ] = await registrations( 'Paula' );
		await pay( signup.id );
		// A repeated notification confirms nothing twice.
		await pay( signup.id );

		const [ confirmed ] = await registrations( 'Paula' );
		expect( confirmed.status ).toBe( 'confirmed' );
		expect( await listed( 'Paula' ) ).toEqual(
			confirmed.tickets.map( ( t ) => t.id )
		);
		expect( confirmed.tickets ).toHaveLength( 2 );

		const row = await audience( 'Paula' );
		expect( row.label ).toBe( 'signed_up' );
		expect( row.payment_in_progress ).toBe( false );
		expect( row.tickets.map( ( t ) => t.status ) ).toEqual( [
			'confirmed',
			'confirmed',
		] );
	} );

	test( 'a later unpaid purchase never hides the confirmed tickets', async () => {
		const confirmedTickets = await listed( 'Paula' );

		await buy( 'Paula', paidId, 1 );
		const [ , second ] = await registrations( 'Paula' );
		expect( second.status ).toBe( 'pending_payment' );
		expect( await listed( 'Paula' ) ).toEqual( confirmedTickets );

		let row = await audience( 'Paula' );
		expect( row.label ).toBe( 'signed_up' );
		expect( row.tickets.map( ( t ) => t.status ).sort() ).toEqual( [
			'confirmed',
			'confirmed',
			'pending_payment',
		] );

		// It expires, and both cleanups run.
		await expire( second.id );
		await expireAudienceHold( row.participant_id );

		const rows = await registrations( 'Paula' );
		expect( rows.map( ( r ) => r.status ) ).toEqual( [
			'confirmed',
			'expired',
		] );
		expect( await listed( 'Paula' ) ).toEqual( confirmedTickets );
		row = await audience( 'Paula' );
		expect( row.label ).toBe( 'signed_up' );
		expect( row.tickets.map( ( t ) => t.id ) ).toEqual( confirmedTickets );
	} );

	test( 'a free registration is listed at once, without a payment', async () => {
		const registered = await buy( 'Freya', freeId );
		expect( registered.status ).toBe( 'confirmed' );

		const [ signup ] = await registrations( 'Freya' );
		expect( signup.status ).toBe( 'confirmed' );
		expect( signup.transaction_id ).toBeNull();
		expect( await listed( 'Freya' ) ).toEqual( [ signup.tickets[ 0 ].id ] );
		expect( ( await audience( 'Freya' ) ).label ).toBe( 'signed_up' );
	} );

	test( 'an expired purchase leaves both rosters, and a late payment restores it', async () => {
		await buy( 'Edgar', paidId );
		const [ signup ] = await registrations( 'Edgar' );
		const participantId = ( await audience( 'Edgar' ) ).participant_id;

		await expire( signup.id );
		expect( ( await registrations( 'Edgar' ) )[ 0 ].status ).toBe(
			'expired'
		);
		expect( await listed( 'Edgar' ) ).toEqual( [] );

		// Until the cleanup runs the hold has only lapsed.
		const lapsed = await audience( 'Edgar' );
		expect( lapsed.label ).toBe( 'pending_payment' );
		expect( lapsed.payment_in_progress ).toBe( false );

		await expireAudienceHold( participantId );
		expect( await audience( 'Edgar' ) ).toBeUndefined();

		await pay( signup.id );
		const [ confirmed ] = await registrations( 'Edgar' );
		expect( confirmed.status ).toBe( 'confirmed' );
		expect( await listed( 'Edgar' ) ).toEqual( [
			confirmed.tickets[ 0 ].id,
		] );
		expect( ( await audience( 'Edgar' ) ).label ).toBe( 'signed_up' );
	} );

	test( 'a purchase the buyer cancels is listed nowhere', async () => {
		await setMollieStatus( 'open' );
		const started = await buy( 'Carla', paidId );
		const token = new URL( started.checkout_url ).searchParams.get(
			'token'
		);

		const who = await buyer( 'Carla' );
		const cancelled = await who.browser.post(
			'/wp-json/fair-events/v1/get-tickets/cancel-payment',
			{ data: { transaction_id: started.transaction_id, token } }
		);
		expect( cancelled.ok(), await cancelled.text() ).toBeTruthy();
		await setMollieStatus( 'paid' );

		const [ signup ] = await registrations( 'Carla' );
		expect( signup.status ).toBe( 'failed' );
		expect( signup.payment_expires_at ).toBeNull();
		expect( await listed( 'Carla' ) ).toEqual( [] );
		expect( ( await audience( 'Carla' ) ).payment_in_progress ).toBe(
			false
		);
	} );

	test( 'a collaborator keeps their role through an unpaid purchase', async () => {
		// Known to the site, and to their browser, from a free registration.
		await buy( 'Colin', freeId );
		const participantId = ( await audience( 'Colin' ) ).participant_id;
		await setRole( participantId, { label: 'collaborator' } );

		await buy( 'Colin', paidId );
		const [ , purchase ] = await registrations( 'Colin' );
		expect( purchase.status ).toBe( 'pending_payment' );
		expect( ( await audience( 'Colin' ) ).label ).toBe( 'collaborator' );

		await fail( purchase.id );
		await expireAudienceHold( participantId );
		expect( ( await audience( 'Colin' ) ).label ).toBe( 'collaborator' );
	} );

	test( 'the holder of a ticket someone else bought stays admitted through their own unpaid purchase', async () => {
		// Gina registers, then her own ticket is cancelled: she stays
		// listed as interested.
		await buy( 'Gina', freeId );
		const gina = await audience( 'Gina' );
		await ticketAction( gina.tickets[ 0 ].id, 'cancel' );
		expect( ( await audience( 'Gina' ) ).label ).toBe( 'interested' );

		// Paula gives her one of her confirmed tickets.
		const [ given ] = await listed( 'Paula' );
		await ticketAction( given, 'assign', {
			participant_id: gina.participant_id,
		} );
		expect( ( await audience( 'Gina' ) ).label ).toBe( 'signed_up' );

		// Gina starts a purchase of her own and lets it expire.
		await buy( 'Gina', paidId );
		const purchase = ( await registrations( 'Gina' ) ).pop();
		expect( purchase.status ).toBe( 'pending_payment' );
		let row = await audience( 'Gina' );
		expect( row.label ).toBe( 'signed_up' );
		expect( row.tickets.map( ( t ) => t.id ) ).toContain( given );

		await expire( purchase.id );
		await expireAudienceHold( gina.participant_id );
		row = await audience( 'Gina' );
		expect( row.label ).toBe( 'signed_up' );
		expect( row.tickets.map( ( t ) => t.id ) ).toEqual( [ given ] );
	} );

	test( 'a ticket given to someone who is still paying admits them, also after their purchase expires', async () => {
		await buy( 'Hugo', paidId );
		const [ purchase ] = await registrations( 'Hugo' );
		const hugo = await audience( 'Hugo' );
		expect( hugo.label ).toBe( 'pending_payment' );

		const given = ( await listed( 'Paula' ) ).pop();
		await ticketAction( given, 'assign', {
			participant_id: hugo.participant_id,
		} );
		expect( ( await audience( 'Hugo' ) ).label ).toBe( 'signed_up' );

		await expire( purchase.id );
		await expireAudienceHold( hugo.participant_id );

		const row = await audience( 'Hugo' );
		expect( row ).toBeDefined();
		expect( row.label ).toBe( 'signed_up' );
		expect( row.tickets.map( ( t ) => t.id ) ).toEqual( [ given ] );
	} );
} );
