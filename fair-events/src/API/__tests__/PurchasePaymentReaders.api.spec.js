/**
 * Purchase payment readers (#2141, second pull request of stage 5 of #2111;
 * PAYMENT_HISTORY_MIGRATION.md §8.15), unconditional since #2251: with no
 * reader activation recorded, the get-tickets list carries every attempt of
 * each purchase, Connector's transaction view lists the purchases a
 * transaction pays for, the participant detail lists the participant's
 * purchases as the purchaser, the buyer's payment callback resolves an
 * attempt's own purchases, and payment notifications are enriched from the
 * links, never the Fair Audience ledger. An attempt without links names no
 * purchase, whatever a purchase's latest-attempt pointer says. Results stay
 * the same through a Fair Audience deactivation, and payment information
 * missing without Connector is said as such.
 *
 * The payment-readers.php fixture stashes any recorded reader activation
 * and puts it back afterwards, so these tests run without one.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { timingFields } from '../../../../e2e/support/event-timing.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const root = new URL( '../../../../', import.meta.url );

async function wpEnv( args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', ...args ],
		{ cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
	);
	return stdout;
}

async function fixture( script, marker, action, data = {} ) {
	const stdout = await wpEnv( [
		'wp',
		'eval-file',
		`wp-content/mu-plugins/scripts/${ script }`,
		action,
		JSON.stringify( data ),
	] );
	const match = stdout.match( new RegExp( `${ marker }:(\\{.*\\})` ) );
	if ( ! match ) {
		throw new Error( `Expected ${ marker } output, got:\n${ stdout }` );
	}
	return JSON.parse( match[ 1 ] );
}

const readers = ( action, data ) =>
	fixture( 'payment-readers.php', 'E2E_PAYMENT_READERS', action, data );
const tickets = ( action, data ) =>
	fixture(
		'seed-event-statistics-tickets.php',
		'E2E_EVENT_STATISTICS_TICKETS',
		action,
		data
	);

async function login( api, user, password ) {
	await api.post( '/wp-login.php', {
		form: { log: user, pwd: password, rememberme: 'forever' },
	} );
	const nonce = await api.get( '/wp-admin/admin-ajax.php?action=rest-nonce' );
	expect( nonce.ok() ).toBeTruthy();
	return { 'X-WP-Nonce': await nonce.text() };
}

function addDays( date, days ) {
	const value = new Date( `${ date }T12:00:00Z` );
	value.setUTCDate( value.getUTCDate() + days );
	return value.toISOString().slice( 0, 10 );
}

test.describe.serial( 'Purchase payments from Fair Events records', () => {
	test.describe.configure( { timeout: 240 * 1000 } );

	let api;
	let anonymous;
	let adminHeaders;
	let prepared;
	let audienceDeactivated = false;
	let connectorDeactivated = false;
	const today = new Date().toISOString().slice( 0, 10 );
	const earlier = `${ addDays( today, -3 ) } 12:00:00`;
	const later = `${ addDays( today, -2 ) } 12:00:00`;
	const eventIds = [];
	const eventDateIds = [];
	const transactionIds = [];
	const participants = {};
	const signups = {};
	const tx = {};
	let eventTitle;

	async function createOccurrence( name, offset ) {
		const title = `Purchase readers ${ name } ${ Date.now() }`;
		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( post.ok() ).toBeTruthy();
		const eventId = ( await post.json() ).id;
		eventIds.push( eventId );
		const date = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `${ title } date`,
				...timingFields(
					`${ addDays( today, offset ) } 10:00:00`,
					`${ addDays( today, offset ) } 22:00:00`
				),
			},
		} );
		expect( date.ok() ).toBeTruthy();
		const eventDateId = ( await date.json() ).id;
		const link = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders, data: { event_id: eventId } }
		);
		expect( link.ok() ).toBeTruthy();
		eventDateIds.push( eventDateId );
		return { eventDateId, title };
	}

	async function participant( name ) {
		const response = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name,
					email: `purchase-readers-${ Date.now() }-${ Math.floor(
						Math.random() * 1e6
					) }@example.test`,
				},
			}
		);
		expect( response.ok() ).toBeTruthy();
		return ( await response.json() ).id;
	}

	async function transaction( data ) {
		const { transactionId } = await readers( 'transaction', data );
		transactionIds.push( transactionId );
		return transactionId;
	}

	async function link( signupId, transactionId, amount, createdAt, role ) {
		await readers( 'link', {
			signupId,
			transactionId,
			amount,
			createdAt,
			role: role ?? 'charge',
		} );
	}

	async function listed( eventDateId ) {
		const response = await api.get(
			`/wp-json/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( response.status() ).toBe( 200 );
		const body = await response.json();
		return Object.fromEntries( body.map( ( row ) => [ row.id, row ] ) );
	}

	async function transactionView( transactionId ) {
		const response = await api.get(
			`/wp-json/fair-payments-connector/v1/transactions/${ transactionId }`,
			{ headers: adminHeaders }
		);
		expect( response.status() ).toBe( 200 );
		return response.json();
	}

	async function activity( participantId ) {
		const response = await api.get(
			`/wp-json/fair-audience/v1/participants/${ participantId }/activity`,
			{ headers: adminHeaders }
		);
		expect( response.status() ).toBe( 200 );
		return response.json();
	}

	test.beforeAll( async () => {
		// A dozen sequential fixture calls overrun the default hook budget.
		test.setTimeout( 240 * 1000 );
		api = await request.newContext( { baseURL: BASE_URL } );
		anonymous = await request.newContext( { baseURL: BASE_URL } );
		adminHeaders = await login( api, ADMIN_USER, ADMIN_PASSWORD );

		prepared = await readers( 'prepare' );

		const a = await createOccurrence( 'A', 10 );
		const b = await createOccurrence( 'B', 11 );
		eventTitle = a.title;
		const config = await tickets( 'configure', {
			eventDateId: a.eventDateId,
			ticketTypes: [ { name: 'Regular', capacity: null } ],
			options: [ { name: 'Workshop', capacity: null } ],
		} );
		const [ ticketTypeId ] = config.ticketTypeIds;
		const [ optionId ] = config.optionIds;

		participants.buyer = await participant( 'Purchase Buyer' );
		participants.holder = await participant( 'Ticket Holder' );

		// S1 on A, bought by the buyer: a failed attempt, a paid retry
		// (the latest attempt) and a preserved refund-labelled record. The
		// second ticket is held by someone else.
		const s1 = await tickets( 'signup', {
			eventDateId: a.eventDateId,
			participantId: participants.buyer,
			ticketTypeId,
			quantity: 2,
			createdAt: earlier,
			units: [
				{
					status: 'confirmed',
					activities: [ { optionId, name: 'Workshop' } ],
				},
				{ status: 'confirmed' },
			],
		} );
		signups.s1 = s1.signupId;
		await tickets( 'transfer', {
			ticketId: s1.ticketIds[ 1 ],
			holderParticipantId: participants.holder,
		} );
		tx.failed = await transaction( {
			amount: 30,
			status: 'failed',
			createdAt: earlier,
		} );
		await link( signups.s1, tx.failed, 30, earlier );
		tx.refund = await transaction( {
			amount: 5,
			status: 'paid',
			createdAt: earlier,
		} );
		await link( signups.s1, tx.refund, 0, earlier, 'legacy_refund_record' );
		tx.paid = await transaction( {
			amount: 30,
			status: 'paid',
			createdAt: later,
		} );
		await link( signups.s1, tx.paid, 30, later );
		await readers( 'latest', {
			signupId: signups.s1,
			transactionId: tx.paid,
		} );

		// One payment shared by S2 on A and S3 on B, €12 each.
		tx.shared = await transaction( {
			amount: 24,
			status: 'paid',
			createdAt: earlier,
		} );
		for ( const [ key, eventDateId ] of [
			[ 's2', a.eventDateId ],
			[ 's3', b.eventDateId ],
		] ) {
			signups[ key ] = (
				await tickets( 'signup', {
					eventDateId,
					quantity: 1,
					createdAt: earlier,
					units: [ { status: 'confirmed' } ],
				} )
			).signupId;
			await link( signups[ key ], tx.shared, 12, earlier );
			await readers( 'latest', {
				signupId: signups[ key ],
				transactionId: tx.shared,
			} );
		}

		// S4 on B: its latest attempt is a paid payment with no links.
		signups.s4 = (
			await tickets( 'signup', {
				eventDateId: b.eventDateId,
				participantId: participants.buyer,
				quantity: 1,
				createdAt: later,
				units: [ { status: 'confirmed' } ],
			} )
		).signupId;
		tx.unlinked = await transaction( {
			amount: 18,
			status: 'paid',
			createdAt: later,
		} );
		await readers( 'latest', {
			signupId: signups.s4,
			transactionId: tx.unlinked,
		} );

		signups.dateA = a.eventDateId;
		signups.dateB = b.eventDateId;
	} );

	test.afterAll( async () => {
		if ( audienceDeactivated ) {
			await wpEnv( [ 'wp', 'plugin', 'activate', 'fair-audience' ] );
		}
		if ( connectorDeactivated ) {
			await wpEnv( [
				'wp',
				'plugin',
				'activate',
				'fair-payments-connector',
			] );
		}
		await readers( 'cleanup', { transactionIds } );
		await tickets( 'cleanup', {
			eventDateIds,
			configuredEventDateIds: eventDateIds.slice( 0, 1 ),
		} );
		if ( prepared ) {
			await readers( 'restore' );
		}
		for ( const id of eventIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of Object.values( participants ) ) {
			await api.delete(
				`/wp-json/fair-audience/v1/participants/${ id }`,
				{
					headers: adminHeaders,
				}
			);
		}
		await api?.dispose();
		await anonymous?.dispose();
	} );

	test( 'never resolves an attempt without links from a latest-attempt pointer', async () => {
		expect( ( await readers( 'facts' ) ).activation ).toBeNull();

		const s4 = ( await listed( signups.dateB ) )[ signups.s4 ];
		expect( Number( s4.transaction_id ) ).toBe( tx.unlinked );
		expect( s4.payment_history ).toMatchObject( {
			payment_information: 'available',
			paid_amount: 0,
			payments: [],
		} );
		expect(
			(
				await readers( 'attempt-purchases', {
					transactionId: tx.unlinked,
				} )
			).signupIds
		).toEqual( [] );
		expect( ( await transactionView( tx.unlinked ) ).purchases ).toEqual(
			[]
		);
		const { context } = await readers( 'notification', {
			transactionId: tx.unlinked,
		} );
		expect( context.event_title ).toBeUndefined();
	} );

	test( 'lists every attempt of each purchase', async () => {
		const a = await listed( signups.dateA );
		const s1 = a[ signups.s1 ];
		// transaction_id keeps meaning the latest attempt.
		expect( Number( s1.transaction_id ) ).toBe( tx.paid );
		expect( s1.payment_history.payment_information ).toBe( 'available' );
		expect( s1.payment_history.paid_amount ).toBe( 30 );
		expect(
			s1.payment_history.payments.map( ( payment ) => [
				payment.transaction_id,
				payment.role,
				payment.transaction.status,
				payment.counts_as_revenue,
				payment.latest,
			] )
		).toEqual( [
			[ tx.failed, 'charge', 'failed', false, false ],
			[ tx.refund, 'legacy_refund_record', 'paid', false, false ],
			[ tx.paid, 'charge', 'paid', true, true ],
		] );

		const s2 = a[ signups.s2 ].payment_history.payments;
		expect( s2 ).toHaveLength( 1 );
		expect( s2[ 0 ] ).toMatchObject( {
			transaction_id: tx.shared,
			allocated_amount: 12,
			transaction: { amount: 24 },
			latest: true,
		} );
		expect( a[ signups.s2 ].payment_history.paid_amount ).toBe( 12 );

		const listing = `/wp-json/fair-events/v1/get-tickets?event_date=${ signups.dateA }`;
		expect( ( await anonymous.get( listing ) ).status() ).toBe( 401 );
	} );

	test( 'shows which purchases a transaction pays for', async () => {
		const shared = await transactionView( tx.shared );
		expect(
			shared.purchases.map( ( purchase ) => [
				purchase.signup_id,
				purchase.event_date_id,
				purchase.role,
				purchase.allocated_amount,
			] )
		).toEqual( [
			[ signups.s2, signups.dateA, 'charge', 12 ],
			[ signups.s3, signups.dateB, 'charge', 12 ],
		] );
		expect( shared.purchases[ 0 ].event.manage_url ).toContain(
			`event_date_id=${ signups.dateA }`
		);
		// The editable event column doesn't decide it.
		expect( shared.event_date_id ).toBeNull();

		const refund = await transactionView( tx.refund );
		expect( refund.purchases ).toEqual( [
			expect.objectContaining( {
				signup_id: signups.s1,
				role: 'legacy_refund_record',
				allocated_amount: 0,
			} ),
		] );
	} );

	test( 'lists the purchaser’s purchases, not the holder’s tickets', async () => {
		const buyer = await activity( participants.buyer );
		expect( buyer ).not.toHaveProperty( 'payment_readers' );
		expect( buyer.payment_information ).toBe( 'available' );
		expect( buyer.purchases ).toHaveLength( 2 );
		expect(
			buyer.purchases.find(
				( purchase ) => purchase.signup_id === signups.s4
			)
		).toMatchObject( { paid_amount: 0, payments: [] } );
		expect(
			buyer.purchases.find(
				( purchase ) => purchase.signup_id === signups.s1
			)
		).toMatchObject( {
			signup_id: signups.s1,
			event_date_id: signups.dateA,
			event_title: eventTitle,
			quantity: 2,
			ticket_type_name: 'Regular',
			latest_transaction_id: tx.paid,
			paid_amount: 30,
		} );
		expect(
			buyer.purchases
				.find( ( purchase ) => purchase.signup_id === signups.s1 )
				.payments.map( ( payment ) => [
					payment.transaction_id,
					payment.transaction_status,
				] )
		).toEqual( [
			[ tx.failed, 'failed' ],
			[ tx.refund, 'success' ],
			[ tx.paid, 'success' ],
		] );

		const holder = await activity( participants.holder );
		expect( holder.purchases ).toEqual( [] );
	} );

	test( 'resolves a superseded attempt’s own purchase for the buyer', async () => {
		expect(
			(
				await readers( 'attempt-purchases', {
					transactionId: tx.failed,
				} )
			).signupIds
		).toEqual( [ signups.s1 ] );
		expect(
			(
				await readers( 'attempt-purchases', {
					transactionId: tx.shared,
				} )
			).signupIds
		).toEqual( [ signups.s2, signups.s3 ] );
	} );

	test( 'enriches payment notifications from the links', async () => {
		const { context } = await readers( 'notification', {
			transactionId: tx.paid,
		} );
		expect( context ).toMatchObject( {
			event_title: eventTitle,
			ticket_label: 'Regular',
			activities: 'Workshop',
			participant_name: 'Purchase Buyer',
		} );
	} );

	test( 'keeps every result through a Fair Audience deactivation and reactivation', async () => {
		// Payment fields only: consent and profile links are Audience data.
		const payments = async () =>
			Object.fromEntries(
				Object.entries( await listed( signups.dateA ) ).map(
					( [ id, row ] ) => [
						id,
						{
							transaction_id: row.transaction_id,
							payment_history: row.payment_history,
						},
					]
				)
			);
		const before = {
			a: await payments(),
			shared: ( await transactionView( tx.shared ) ).purchases,
		};

		await wpEnv( [ 'wp', 'plugin', 'deactivate', 'fair-audience' ] );
		audienceDeactivated = true;
		expect( await payments() ).toEqual( before.a );
		expect( ( await transactionView( tx.shared ) ).purchases ).toEqual(
			before.shared
		);

		await wpEnv( [ 'wp', 'plugin', 'activate', 'fair-audience' ] );
		audienceDeactivated = false;
		expect( await payments() ).toEqual( before.a );
		expect( ( await transactionView( tx.shared ) ).purchases ).toEqual(
			before.shared
		);
	} );

	test( 'says payment information is unavailable without Fair Payments Connector', async () => {
		await wpEnv( [
			'wp',
			'plugin',
			'deactivate',
			'fair-payments-connector',
		] );
		connectorDeactivated = true;

		const s1 = ( await listed( signups.dateA ) )[ signups.s1 ];
		expect( s1.payment_history.payment_information ).toBe( 'unavailable' );
		expect( s1.payment_history.paid_amount ).toBeNull();
		expect( s1.payment_history.payments ).toHaveLength( 3 );
		for ( const payment of s1.payment_history.payments ) {
			expect( payment.transaction ).toBeNull();
			expect( payment.transaction_missing ).toBe( false );
			expect( payment.counts_as_revenue ).toBe( false );
		}

		const buyer = await activity( participants.buyer );
		expect( buyer.payment_information ).toBe( 'unavailable' );
		expect( buyer.purchases[ 0 ].paid_amount ).toBeNull();

		await wpEnv( [
			'wp',
			'plugin',
			'activate',
			'fair-payments-connector',
		] );
		connectorDeactivated = false;
		expect(
			( await listed( signups.dateA ) )[ signups.s1 ].payment_history
				.paid_amount
		).toBe( 30 );
	} );
} );
