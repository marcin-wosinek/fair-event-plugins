/**
 * Playwright API tests for a participant buying again for a date they
 * already hold a ticket for (#1534).
 *
 * Purchases go through the public fair-events/v1/get-tickets route against
 * the Mollie double from e2e/mu-plugins, each with its own idempotency key.
 * The participant keeps one relationship with the event date; every
 * purchase keeps its own signup and transaction, linked to that participant
 * and recorded in their ledger. Payment notifications and the buyer's
 * captured mail are read through the test-only fair-e2e/v1 routes.
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

test.describe.serial( 'A participant buys again for the same date', () => {
	let api;
	let visitor;
	let postId;
	let eventDateId;
	let standardId;
	let supporterId;
	let participantId;

	const email = `repeat-purchase-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;
	const purchases = [];

	// The buyer's own browser throughout: recognised from the second
	// purchase on by the session cookie the first one set.
	async function buy( data ) {
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			data: {
				event_date_id: eventDateId,
				name: 'Repeat Buyer',
				email,
				_honeypot: '',
				...data,
			},
		} );
		return { status: res.status(), body: await res.json() };
	}

	async function signups() {
		const res = await api.get(
			`/wp-json/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() )
			.filter( ( row ) => row.email === email )
			.sort( ( a, b ) => a.id - b.id );
	}

	async function linkState( transactionId, signupId ) {
		const res = await api.get(
			'/wp-json/fair-e2e/v1/transaction-participants/state',
			{
				headers: adminHeaders,
				params: {
					transaction_id: transactionId,
					'signup_ids[0]': signupId,
				},
			}
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	}

	async function relationships() {
		const res = await api.get(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).filter(
			( row ) => Number( row.participant_id ) === participantId
		);
	}

	async function fixture( path, signupId ) {
		const res = await api.post(
			`/wp-json/fair-e2e/v1/ticket-capacity/${ path }`,
			{ headers: adminHeaders, data: { signup_id: signupId } }
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
	}

	async function confirmationMails() {
		const res = await api.get( '/wp-json/fair-e2e/v1/checkout-keys/mail', {
			headers: adminHeaders,
			params: { email },
		} );
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).filter( ( mail ) =>
			mail.subject.includes( 'Signup confirmed' )
		);
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		visitor = await request.newContext( { baseURL: BASE_URL } );

		const title = `Repeat purchases ${ Date.now() }`;
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
				start_datetime: '2035-11-05 10:00:00',
				end_datetime: '2035-11-05 12:00:00',
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
					ticket_types: [ type( 'Standard' ), type( 'Supporter' ) ],
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
							price: 30,
						},
					],
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();
		[ standardId, supporterId ] = ticketsBody.ticket_types.map(
			( ticketType ) => ticketType.id
		);
	} );

	test.afterAll( async () => {
		for ( const signup of eventDateId ? await signups() : [] ) {
			await api.delete(
				`/wp-json/fair-events/v1/get-tickets/${ signup.id }`,
				{ headers: adminHeaders }
			);
		}
		if ( participantId ) {
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
		await visitor.dispose();
		await api.dispose();
	} );

	test( 'the first purchase is paid and signs the participant up', async () => {
		const first = await buy( {
			ticket_type_id: standardId,
			quantity: 1,
			idempotency_key: randomUUID(),
		} );
		expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
		expect( first.body.status ).toBe( 'payment_required' );

		const [ signup ] = await signups();
		purchases.push( {
			signupId: signup.id,
			transactionId: first.body.transaction_id,
		} );
		participantId = Number( signup.participant_id );
		expect( participantId ).toBeGreaterThan( 0 );

		await fixture( 'pay', signup.id );

		const rows = await relationships();
		expect( rows ).toHaveLength( 1 );
		expect( rows[ 0 ].label ).toBe( 'signed_up' );
	} );

	test( 'a signed-up participant buys another ticket of another type', async () => {
		const key = randomUUID();
		const purchase = {
			ticket_type_id: supporterId,
			quantity: 2,
			idempotency_key: key,
		};

		// Rejected with 409 already_signed_up before #1534.
		const second = await buy( purchase );
		expect( second.status, JSON.stringify( second.body ) ).toBe( 200 );
		expect( second.body.status ).toBe( 'payment_required' );
		expect( second.body.amount ).toBe( 60 );
		expect( second.body.transaction_id ).not.toBe(
			purchases[ 0 ].transactionId
		);

		// Repeating the key is still that one purchase.
		const again = await buy( purchase );
		expect( again.body ).toEqual( second.body );

		const rows = await signups();
		expect( rows ).toHaveLength( 2 );
		expect( rows[ 1 ].tickets ).toHaveLength( 2 );
		expect( Number( rows[ 1 ].participant_id ) ).toBe( participantId );
		purchases.push( {
			signupId: rows[ 1 ].id,
			transactionId: second.body.transaction_id,
		} );
	} );

	test( 'each transaction is linked to the participant and recorded in their ledger', async () => {
		const states = [];
		for ( const purchase of purchases ) {
			states.push(
				await linkState( purchase.transactionId, purchase.signupId )
			);
		}

		for ( const [ index, linked ] of states.entries() ) {
			expect( linked.participant_id ).toBe( participantId );
			expect( linked.signups[ 0 ] ).toMatchObject( {
				participant_id: participantId,
				transaction_id: purchases[ index ].transactionId,
				event_date_id: eventDateId,
			} );
			// Recorded once, also for the purchase made while the
			// relationship was already signed up.
			expect( linked.ledger ).toHaveLength( 1 );
			expect( linked.ledger[ 0 ].participant_id ).toBe( participantId );
		}

		// Both are recorded against the participant's one relationship.
		expect( states[ 1 ].ledger[ 0 ].event_participant_id ).toBe(
			states[ 0 ].ledger[ 0 ].event_participant_id
		);
		expect( await relationships() ).toHaveLength( 1 );
	} );

	test( 'the second payment confirms its own tickets and names its own ticket type', async () => {
		await fixture( 'pay', purchases[ 1 ].signupId );
		// The same notification again changes and sends nothing more.
		await fixture( 'pay', purchases[ 1 ].signupId );

		const rows = await signups();
		expect( rows.map( ( row ) => row.status ) ).toEqual( [
			'confirmed',
			'confirmed',
		] );
		expect( rows[ 0 ].tickets.map( ( t ) => t.status ) ).toEqual( [
			'confirmed',
		] );
		expect( rows[ 1 ].tickets.map( ( t ) => t.status ) ).toEqual( [
			'confirmed',
			'confirmed',
		] );

		const relationship = await relationships();
		expect( relationship ).toHaveLength( 1 );
		expect( relationship[ 0 ].label ).toBe( 'signed_up' );

		// One confirmation per purchase, each describing that purchase —
		// not the ticket type the relationship carries from the first one.
		const mails = await confirmationMails();
		expect( mails ).toHaveLength( 2 );
		expect( mails[ 0 ].body ).toContain( 'Standard' );
		expect( mails[ 0 ].body ).not.toContain( 'Supporter' );
		expect( mails[ 1 ].body ).toContain( 'Supporter' );
		expect( mails[ 1 ].body ).not.toContain( 'Standard' );

		const ledger = await linkState(
			purchases[ 1 ].transactionId,
			purchases[ 1 ].signupId
		);
		expect( ledger.ledger ).toHaveLength( 1 );
	} );

	test( 'a later purchase that fails leaves the participant signed up', async () => {
		const third = await buy( {
			ticket_type_id: standardId,
			quantity: 1,
			idempotency_key: randomUUID(),
		} );
		expect( third.status, JSON.stringify( third.body ) ).toBe( 200 );

		const rows = await signups();
		expect( rows ).toHaveLength( 3 );
		await fixture( 'fail', rows[ 2 ].id );

		expect( ( await signups() ).map( ( row ) => row.status ) ).toEqual( [
			'confirmed',
			'confirmed',
			'failed',
		] );
		const relationship = await relationships();
		expect( relationship ).toHaveLength( 1 );
		expect( relationship[ 0 ].label ).toBe( 'signed_up' );
	} );
} );
