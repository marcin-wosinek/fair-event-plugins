/**
 * Playwright API tests linking get-tickets transactions to the participant
 * their signups record (#1466).
 *
 * Purchases go through the public fair-events/v1/get-tickets route against
 * the Mollie double from e2e/mu-plugins. The payment administration view is
 * read through fair-payments-connector/v1/transactions/{id} and participant
 * activity through fair-audience/v1/participants/{id}/activity. History and
 * conflicts production data can hold, a repeated callback, the repair and
 * Fair Audience being inactive are driven through the test-only
 * fair-e2e/v1/transaction-participants routes.
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

const uniqueEmail = ( label ) =>
	`tx-participant-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

test.describe
	.serial( 'Get-tickets transactions link to their participant', () => {
	let api;
	const postIds = [];
	const participantIds = new Set();
	let single;
	let series;

	let returning;
	let signedUp;
	let seriesPurchase;

	async function createEvent( title, eventDateData, ticketType, price ) {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		postIds.push( postId );

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: { title, link_type: 'post', ...eventDateData },
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }`,
			{ headers: adminHeaders, data: { event_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const ticketsRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ edBody.id }/tickets`,
			{
				headers: adminHeaders,
				data: {
					ticket_types: [ ticketType ],
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
							price,
						},
					],
					settings: {},
				},
			}
		);
		const ticketsBody = await ticketsRes.json();
		expect( ticketsRes.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();

		return {
			eventDateId: edBody.id,
			occurrenceIds: [
				edBody.id,
				...( edBody.generated_occurrences || [] ).map( ( o ) => o.id ),
			],
			typeId: ticketsBody.ticket_types[ 0 ].id,
		};
	}

	async function buy( data, headers = {} ) {
		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post( '/wp-json/fair-events/v1/get-tickets', {
			headers,
			data: { name: 'Transaction Link Buyer', _honeypot: '', ...data },
		} );
		const body = await res.json();
		await visitor.dispose();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		expect( body.status ).toBe( 'payment_required' );
		return {
			transactionId: body.transaction_id,
			token: new URL( body.checkout_url ).searchParams.get( 'token' ),
		};
	}

	async function buySingle( email, headers = {} ) {
		const purchase = await buy(
			{
				event_date_id: single.eventDateId,
				email,
				ticket_type_id: single.typeId,
				quantity: 1,
			},
			headers
		);
		const [ signup ] = await signupsFor( single.eventDateId, email );
		return { ...purchase, signupIds: [ signup.id ] };
	}

	async function signupsFor( eventDateId, email ) {
		const res = await api.get(
			`/wp-json/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		const rows = Array.isArray( body ) ? body : body.signups || [];
		return rows.filter( ( row ) => row.email === email );
	}

	async function state( transactionId, signupIds = [] ) {
		const res = await api.get(
			'/wp-json/fair-e2e/v1/transaction-participants/state',
			{
				headers: adminHeaders,
				params: {
					transaction_id: transactionId,
					...Object.fromEntries(
						signupIds.map( ( id, i ) => [
							`signup_ids[${ i }]`,
							id,
						] )
					),
				},
			}
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		for ( const signup of body.signups ) {
			if ( signup.participant_id ) {
				participantIds.add( signup.participant_id );
			}
		}
		return body;
	}

	async function paymentAdminPerson( transactionId ) {
		const res = await api.get(
			`/wp-json/fair-payments-connector/v1/transactions/${ transactionId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).participant;
	}

	async function activityTransactionIds( participantId ) {
		const res = await api.get(
			`/wp-json/fair-audience/v1/participants/${ participantId }/activity`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).events.map( ( e ) => e.transaction_id );
	}

	async function setTransaction( data ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/transaction-participants/transaction',
			{ headers: adminHeaders, data }
		);
		expect( res.ok() ).toBeTruthy();
	}

	async function replay( transactionId, signupIds ) {
		const res = await api.post(
			'/wp-json/fair-e2e/v1/transaction-participants/replay',
			{
				headers: adminHeaders,
				data: { transaction_id: transactionId, signup_ids: signupIds },
			}
		);
		expect( res.ok() ).toBeTruthy();
	}

	async function createParticipant( email ) {
		const res = await api.post( '/wp-json/fair-audience/v1/participants', {
			headers: adminHeaders,
			data: { name: 'Existing Buyer', email },
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		participantIds.add( body.id );
		return body.id;
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		single = await createEvent(
			`Transaction link single ${ Date.now() }`,
			{
				start_datetime: '2035-10-01 10:00:00',
				end_datetime: '2035-10-01 12:00:00',
			},
			{
				name: 'Standard',
				capacity: null,
				minimum_activities: 0,
				disable_at: null,
				recurrence_scope: 'single_instance',
				group_ids: [],
			},
			15
		);

		series = await createEvent(
			`Transaction link series ${ Date.now() }`,
			{
				start_datetime: '2035-10-08 10:00:00',
				end_datetime: '2035-10-08 12:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
			{
				name: 'Pick sessions',
				capacity: null,
				minimum_activities: 0,
				disable_at: null,
				recurrence_scope: 'multiple_instances',
				minimum_instances: 1,
				group_ids: [],
			},
			10
		);
	} );

	test.afterAll( async () => {
		for ( const id of participantIds ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ id }`,
				{
					headers: adminHeaders,
				}
			);
		}
		for ( const id of postIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'a first-time buyer is the Person in payment administration and sees the transaction in their activity', async () => {
		const firstTime = await buySingle( uniqueEmail( 'first' ) );

		const after = await state(
			firstTime.transactionId,
			firstTime.signupIds
		);
		const participantId = after.signups[ 0 ].participant_id;
		expect( participantId ).toBeTruthy();
		expect( after.participant_id ).toBe( participantId );
		expect( after.ledger ).toEqual( [
			expect.objectContaining( { participant_id: participantId } ),
		] );

		const person = await paymentAdminPerson( firstTime.transactionId );
		expect( person?.id ).toBe( participantId );
		expect( await activityTransactionIds( participantId ) ).toContain(
			firstTime.transactionId
		);
	} );

	test( 'a returning buyer stays linked to the resulting transaction', async () => {
		const email = uniqueEmail( 'returning' );
		const participantId = await createParticipant( email );

		returning = await buySingle( email );

		const after = await state(
			returning.transactionId,
			returning.signupIds
		);
		expect( after.signups[ 0 ].participant_id ).toBe( participantId );
		expect( after.participant_id ).toBe( participantId );
		expect(
			( await paymentAdminPerson( returning.transactionId ) )?.id
		).toBe( participantId );
		expect( await activityTransactionIds( participantId ) ).toContain(
			returning.transactionId
		);
	} );

	test( 'a purchase by a participant already signed up records the transaction on that registration', async () => {
		const email = uniqueEmail( 'signed-up' );
		const participantId = await createParticipant( email );
		const addRes = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ single.eventDateId }/participants`,
			{
				headers: adminHeaders,
				data: { participant_id: participantId, label: 'signed_up' },
			}
		);
		expect( addRes.ok(), await addRes.text() ).toBeTruthy();

		signedUp = await buySingle( email );

		const after = await state( signedUp.transactionId, signedUp.signupIds );
		expect( after.participant_id ).toBe( participantId );
		expect( after.ledger ).toEqual( [
			expect.objectContaining( {
				participant_id: participantId,
				event_date_id: single.eventDateId,
			} ),
		] );
	} );

	test( 'a retried payment links its new transaction and keeps the earlier one', async () => {
		// Viewing a transaction in payment administration syncs it with
		// the Mollie double, which reports it paid, so this purchase is left
		// unviewed until it has failed.
		const purchase = await buySingle( uniqueEmail( 'retry' ) );
		const before = await state(
			purchase.transactionId,
			purchase.signupIds
		);
		const participantId = before.signups[ 0 ].participant_id;
		expect( before.participant_id ).toBe( participantId );

		await setTransaction( {
			transaction_id: purchase.transactionId,
			status: 'failed',
		} );

		const visitor = await request.newContext( { baseURL: BASE_URL } );
		const res = await visitor.post(
			'/wp-json/fair-events/v1/get-tickets/retry-payment',
			{
				data: {
					transaction_id: purchase.transactionId,
					token: purchase.token,
				},
			}
		);
		const body = await res.json();
		await visitor.dispose();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		expect( body.transaction_id ).not.toBe( purchase.transactionId );

		const retried = await state( body.transaction_id, purchase.signupIds );
		expect( retried.signups[ 0 ].transaction_id ).toBe(
			body.transaction_id
		);
		expect( retried.participant_id ).toBe( participantId );
		expect( retried.ledger ).toEqual( [
			expect.objectContaining( { participant_id: participantId } ),
		] );

		const original = await state( purchase.transactionId );
		expect( original.participant_id ).toBe( participantId );
		expect( original.ledger ).toHaveLength( 1 );

		expect( await activityTransactionIds( participantId ) ).toContain(
			body.transaction_id
		);
	} );

	test( 'a shared series purchase is one transaction attributed to its purchaser on every occurrence', async () => {
		const email = uniqueEmail( 'series' );
		const chosen = series.occurrenceIds.slice( 0, 2 );
		const purchase = await buy( {
			event_date_id: chosen[ 0 ],
			event_date_ids: chosen,
			email,
			ticket_type_id: series.typeId,
		} );

		const signups = [];
		for ( const id of chosen ) {
			signups.push( ...( await signupsFor( id, email ) ) );
		}
		expect( signups ).toHaveLength( 2 );
		seriesPurchase = {
			...purchase,
			signupIds: signups.map( ( s ) => s.id ),
		};

		const after = await state(
			seriesPurchase.transactionId,
			seriesPurchase.signupIds
		);
		const participantId = after.signups[ 0 ].participant_id;
		expect( participantId ).toBeTruthy();
		expect( after.signups[ 1 ].participant_id ).toBe( participantId );
		expect( after.participant_id ).toBe( participantId );
		expect(
			after.ledger.map( ( row ) => row.event_date_id ).sort()
		).toEqual( [ ...chosen ].sort() );
		for ( const row of after.ledger ) {
			expect( row.participant_id ).toBe( participantId );
		}
	} );

	test( 'reprocessing the same transaction adds no duplicate relationships', async () => {
		const before = await state(
			seriesPurchase.transactionId,
			seriesPurchase.signupIds
		);

		await replay( seriesPurchase.transactionId, seriesPurchase.signupIds );
		await replay( seriesPurchase.transactionId, seriesPurchase.signupIds );

		const after = await state(
			seriesPurchase.transactionId,
			seriesPurchase.signupIds
		);
		expect( after.participant_id ).toBe( before.participant_id );
		expect( after.ledger ).toEqual( before.ledger );
	} );

	test( 'an existing link to another participant is never replaced', async () => {
		const other = await createParticipant( uniqueEmail( 'other' ) );
		const before = await state(
			returning.transactionId,
			returning.signupIds
		);

		await setTransaction( {
			transaction_id: returning.transactionId,
			participant_id: other,
		} );
		await replay( returning.transactionId, returning.signupIds );

		const after = await state(
			returning.transactionId,
			returning.signupIds
		);
		expect( after.participant_id ).toBe( other );
		expect( after.ledger ).toEqual( before.ledger );

		await setTransaction( {
			transaction_id: returning.transactionId,
			participant_id: before.participant_id,
		} );
	} );

	test( 'without Fair Audience the purchase completes with no participant link', async () => {
		const purchase = await buySingle( uniqueEmail( 'no-audience' ), {
			'X-Fair-E2E-Without-Audience': '1',
		} );

		const after = await state( purchase.transactionId, purchase.signupIds );
		expect( after.signups[ 0 ].participant_id ).toBeNull();
		expect( after.participant_id ).toBeNull();
		expect( after.ledger ).toEqual( [] );
		expect( await paymentAdminPerson( purchase.transactionId ) ).toBeNull();
	} );

	test( 'the repair links unambiguous history and leaves ambiguous or conflicting records unchanged', async () => {
		// Unambiguous: the link and ledger rows were never written.
		const unlinked = await state(
			returning.transactionId,
			returning.signupIds
		);
		await setTransaction( {
			transaction_id: returning.transactionId,
			participant_id: 0,
			clear_ledger: true,
		} );

		// Ambiguous: the series purchase's signups name different people.
		const other = await createParticipant( uniqueEmail( 'ambiguous' ) );
		const signupRes = await api.post(
			'/wp-json/fair-e2e/v1/transaction-participants/signup',
			{
				headers: adminHeaders,
				data: {
					signup_id: seriesPurchase.signupIds[ 1 ],
					participant_id: other,
				},
			}
		);
		expect( signupRes.ok() ).toBeTruthy();
		await setTransaction( {
			transaction_id: seriesPurchase.transactionId,
			participant_id: 0,
			clear_ledger: true,
		} );

		// Conflicting: linked to someone other than its signup's participant.
		const conflicting = await state(
			signedUp.transactionId,
			signedUp.signupIds
		);
		await setTransaction( {
			transaction_id: signedUp.transactionId,
			participant_id: other,
			clear_ledger: true,
		} );

		const repairRes = await api.post(
			'/wp-json/fair-e2e/v1/transaction-participants/repair',
			{ headers: adminHeaders }
		);
		const summary = await repairRes.json();
		expect( repairRes.ok(), JSON.stringify( summary ) ).toBeTruthy();
		expect( summary.done_at ).toBeTruthy();
		expect( summary.repaired ).toBeGreaterThanOrEqual( 1 );
		expect( summary.skipped ).toBeGreaterThanOrEqual( 2 );

		const repaired = await state( returning.transactionId );
		expect( repaired.participant_id ).toBe( unlinked.participant_id );
		expect( repaired.ledger ).toEqual( unlinked.ledger );

		const ambiguous = await state( seriesPurchase.transactionId );
		expect( ambiguous.participant_id ).toBeNull();
		expect( ambiguous.ledger ).toEqual( [] );

		const conflict = await state( signedUp.transactionId );
		expect( conflict.participant_id ).toBe( other );
		expect( conflict.ledger ).toEqual( [] );
		expect( conflicting.participant_id ).not.toBe( other );
	} );
} );
