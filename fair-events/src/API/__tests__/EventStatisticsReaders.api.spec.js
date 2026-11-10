/**
 * Statistics read Fair Events records unconditionally (#2251; stage 5 of
 * #2111, PAYMENT_HISTORY_MIGRATION.md §8.14): with no reader activation
 * recorded, revenue is the paid allocations of each date's purchases, in
 * three states, a whole-series pass counts once on its master, ticket
 * counts and capacity ignore Fair Audience relationships, and results stay
 * the same through a Fair Audience deactivation and reactivation. Without
 * Fair Payments Connector revenue is unavailable, never 0. The migration
 * page's reader switch keeps its permissions and blockers until #2252
 * removes it.
 *
 * The payment-readers.php fixture stashes any recorded reader activation
 * and puts it back afterwards, so these tests run without one.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { timingFields, startOf } from '../../../../e2e/support/event-timing.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const NAMESPACES = [ 'fair-events/v1', 'fair-audience/v1' ];

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

const confirmed = () => ( { status: 'confirmed' } );

test.describe.serial( 'Statistics from Fair Events records', () => {
	test.describe.configure( { timeout: 240 * 1000 } );

	let api;
	let anonymous;
	let subscriberApi;
	let adminHeaders;
	let subscriberHeaders;
	let subscriberId;
	let prepared;
	let audienceDeactivated = false;
	let connectorDeactivated = false;
	const today = new Date().toISOString().slice( 0, 10 );
	const eventIds = [];
	const eventDateIds = [];
	const transactionIds = [];
	const dates = {};
	const signups = {};
	let series;

	async function createOccurrence( name, offset ) {
		const post = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Readers ${ name } ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( post.ok() ).toBeTruthy();
		const eventId = ( await post.json() ).id;
		eventIds.push( eventId );
		const date = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Readers ${ name } date`,
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
		return eventDateId;
	}

	async function signedUpRelationship( eventDateId ) {
		const participant = await api.post(
			'/wp-json/fair-audience/v1/participants',
			{
				headers: adminHeaders,
				data: {
					name: 'Readers relationship',
					email: `readers-${ Date.now() }@example.test`,
				},
			}
		);
		expect( participant.ok() ).toBeTruthy();
		const participantId = ( await participant.json() ).id;
		const relationship = await api.post(
			`/wp-json/fair-audience/v1/event-dates/${ eventDateId }/participants`,
			{
				headers: adminHeaders,
				data: { participant_id: participantId, label: 'signed_up' },
			}
		);
		expect( relationship.ok() ).toBeTruthy();
		return participantId;
	}

	async function transaction( data ) {
		const { transactionId } = await readers( 'transaction', data );
		transactionIds.push( transactionId );
		return transactionId;
	}

	async function paidLink( signupId, amount, createdAt, data = {} ) {
		const transactionId =
			data.transactionId ??
			( await transaction( {
				amount: data.total ?? amount,
				status: data.status ?? 'paid',
				createdAt,
			} ) );
		await readers( 'link', {
			signupId,
			transactionId,
			amount,
			createdAt,
			role: data.role ?? 'charge',
		} );
		return transactionId;
	}

	// The canonical route and its compatibility alias answer with one body.
	async function statistics( eventDateId ) {
		const bodies = await Promise.all(
			NAMESPACES.map( async ( namespace ) => {
				const response = await api.get(
					`/wp-json/${ namespace }/event-dates/${ eventDateId }/statistics`,
					{ headers: adminHeaders }
				);
				expect( response.status(), namespace ).toBe( 200 );
				return response.json();
			} )
		);
		expect( bodies[ 1 ] ).toEqual( bodies[ 0 ] );
		return bodies[ 0 ];
	}

	test.beforeAll( async () => {
		// A dozen sequential fixture calls overrun the default hook budget.
		test.setTimeout( 240 * 1000 );
		api = await request.newContext( { baseURL: BASE_URL } );
		anonymous = await request.newContext( { baseURL: BASE_URL } );
		adminHeaders = await login( api, ADMIN_USER, ADMIN_PASSWORD );

		const username = `readers-subscriber-${ Date.now() }`;
		const password = 'Readers-test-2141!';
		const user = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username,
				password,
				email: `${ username }@example.test`,
				roles: [ 'subscriber' ],
			},
		} );
		expect( user.ok() ).toBeTruthy();
		subscriberId = ( await user.json() ).id;
		subscriberApi = await request.newContext( { baseURL: BASE_URL } );
		subscriberHeaders = await login( subscriberApi, username, password );

		prepared = await readers( 'prepare' );

		dates.a = await createOccurrence( 'A', 10 );
		dates.b = await createOccurrence( 'B', 11 );
		dates.c = await createOccurrence( 'C', 12 );
		const createdAt = `${ addDays( today, -3 ) } 12:00:00`;

		// A: two tickets, a failed attempt then a paid retry; a preserved
		// refund-labelled record; one ticket sharing a payment with B and C;
		// and a signed-up Fair Audience relationship of the person holding
		// one of the two tickets, which Statistics never counts. As a
		// ticket holder it is never mirrored as a purchase (§4.1), so the
		// counts don't depend on when the shadow sweep runs.
		const holderId = await signedUpRelationship( dates.a );
		const a1 = await tickets( 'signup', {
			eventDateId: dates.a,
			quantity: 2,
			createdAt,
			units: [ confirmed(), confirmed() ],
		} );
		signups.a1 = a1.signupId;
		await tickets( 'transfer', {
			ticketId: a1.ticketIds[ 1 ],
			holderParticipantId: holderId,
		} );
		await paidLink( signups.a1, 30, createdAt, { status: 'failed' } );
		await paidLink( signups.a1, 30, `${ addDays( today, -2 ) } 12:00:00` );
		await paidLink( signups.a1, 0, createdAt, {
			role: 'legacy_refund_record',
			total: 5,
		} );
		const shared = await transaction( {
			amount: 36,
			status: 'paid',
			createdAt,
		} );
		for ( const key of [ 'a', 'b', 'c' ] ) {
			signups[ `${ key }2` ] = (
				await tickets( 'signup', {
					eventDateId: dates[ key ],
					quantity: 1,
					createdAt,
					units: [ confirmed() ],
				} )
			).signupId;
			await paidLink( signups[ `${ key }2` ], 12, createdAt, {
				transactionId: shared,
			} );
		}

		// C: a paid payment naming the date that no purchase holds.
		await transaction( {
			amount: 20,
			status: 'paid',
			createdAt,
			metadata: {
				source: 'fair-events-get-tickets',
				event_date_id: dates.c,
			},
		} );
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
			eventDateIds: [
				...eventDateIds,
				...( series?.occurrenceIds || [] ),
			],
		} );
		if ( prepared ) {
			await readers( 'restore' );
		}
		for ( const id of eventIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		if ( subscriberId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ subscriberId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api?.dispose();
		await anonymous?.dispose();
		await subscriberApi?.dispose();
	} );

	test( 'only administrators can switch, and never while it is blocked', async () => {
		const path = '/wp-json/fair-events/v1/payment-history/readers';
		expect( ( await anonymous.post( path ) ).status() ).toBe( 401 );
		expect(
			(
				await subscriberApi.post( path, { headers: subscriberHeaders } )
			).status()
		).toBe( 403 );

		const facts = await readers( 'facts' );
		expect( facts.blockers.length ).toBeGreaterThan( 0 );
		const refused = await api.post( path, { headers: adminHeaders } );
		expect( refused.status() ).toBe( 409 );
		const body = await refused.json();
		expect( body.code ).toBe( 'readers_blocked' );
		expect( body.data.blockers ).toEqual( facts.blockers );

		const status = await api.get(
			'/wp-json/fair-events/v1/payment-history',
			{ headers: adminHeaders }
		);
		expect( status.ok() ).toBeTruthy();
		expect( ( await status.json() ).readers ).toMatchObject( {
			active: false,
			activation: null,
			blockers: facts.blockers,
		} );
		expect( ( await readers( 'facts' ) ).active ).toBe( false );
	} );

	test( 'reads revenue from paid allocations without any activation', async () => {
		expect( ( await readers( 'facts' ) ).activation ).toBeNull();

		const a = await statistics( dates.a );
		expect( a ).not.toHaveProperty( 'payment_readers' );
		// Only Events purchases admit: the relationship never counts.
		expect( a.total_tickets ).toBe( 3 );
		expect( a.event_capacity.taken ).toBe( 3 );
		// The paid retry and A's share of the shared payment; the failed
		// attempt and the refund-labelled record don't count.
		expect( a.revenue_state ).toBe( 'available' );
		expect( a.total_sales_amount ).toBe( 42 );
		expect( a.unresolved_payments ).toBe( 0 );
		expect( a.reconciliation_url ).toBeNull();
		expect( a.series_pass_revenue ).toBeNull();
		expect( a.amount_series.at( -1 ).amount ).toBeNull();
		expect(
			a.amount_series.find( ( point ) => point.date === today ).amount
		).toBe( 42 );

		const b = await statistics( dates.b );
		expect( b.revenue_state ).toBe( 'available' );
		expect( b.total_sales_amount ).toBe( 12 );

		const c = await statistics( dates.c );
		expect( c.revenue_state ).toBe( 'incomplete' );
		expect( c.total_sales_amount ).toBe( 12 );
		expect( c.unresolved_payments ).toBe( 1 );
		expect( c.reconciliation_url ).toContain(
			'page=fair-events-payment-history'
		);
	} );

	test( 'counts a series pass once, on its master', async () => {
		series = await fixture(
			'seed-event.php',
			'E2E_SEED',
			'three-ticket-scopes',
			{ omitMulti: true }
		);
		const [ masterId, firstId ] = series.occurrenceIds;
		const [ wholeSeriesTypeId ] = series.extraTypeIds;
		const masterDate = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ masterId }`,
			{ headers: adminHeaders }
		);
		const dayBefore = `${ addDays(
			startOf( await masterDate.json() ).slice( 0, 10 ),
			-1
		) } 12:00:00`;

		const pass = (
			await tickets( 'signup', {
				eventDateId: masterId,
				ticketTypeId: wholeSeriesTypeId,
				quantity: 1,
				createdAt: dayBefore,
				units: [ confirmed() ],
			} )
		).signupId;
		await paidLink( pass, 80, dayBefore );
		const single = (
			await tickets( 'signup', {
				eventDateId: firstId,
				ticketTypeId: series.ticketTypeId,
				quantity: 1,
				createdAt: dayBefore,
				units: [ confirmed() ],
			} )
		).signupId;
		await paidLink( single, 15, dayBefore );

		const master = await statistics( masterId );
		expect( master.total_sales_amount ).toBe( 80 );
		expect( master.series_pass_revenue ).toBeNull();

		const first = await statistics( firstId );
		expect( first.total_tickets ).toBe( 2 );
		expect( first.total_sales_amount ).toBe( 15 );
		expect( first.series_pass_revenue ).toBe( 80 );
	} );

	test( 'keeps every result through a Fair Audience deactivation and reactivation', async () => {
		const ids = [ dates.a, dates.b, dates.c, ...series.occurrenceIds ];
		const before = [];
		for ( const id of ids ) {
			before.push( await statistics( id ) );
		}

		await wpEnv( [ 'wp', 'plugin', 'deactivate', 'fair-audience' ] );
		audienceDeactivated = true;
		for ( const [ index, id ] of ids.entries() ) {
			expect( await statistics( id ) ).toEqual( before[ index ] );
		}

		await wpEnv( [ 'wp', 'plugin', 'activate', 'fair-audience' ] );
		audienceDeactivated = false;
		for ( const [ index, id ] of ids.entries() ) {
			expect( await statistics( id ) ).toEqual( before[ index ] );
		}
	} );

	test( 'reports revenue unavailable, not zero, without Fair Payments Connector', async () => {
		await wpEnv( [
			'wp',
			'plugin',
			'deactivate',
			'fair-payments-connector',
		] );
		connectorDeactivated = true;

		const a = await statistics( dates.a );
		expect( a.revenue_state ).toBe( 'unavailable' );
		expect( a.total_sales_amount ).toBeNull();
		expect( a.series_pass_revenue ).toBeNull();
		expect(
			a.amount_series.every( ( point ) => point.amount === null )
		).toBe( true );
		expect( a.total_tickets ).toBe( 3 );

		await wpEnv( [
			'wp',
			'plugin',
			'activate',
			'fair-payments-connector',
		] );
		connectorDeactivated = false;
		expect( ( await statistics( dates.a ) ).total_sales_amount ).toBe( 42 );
	} );
} );
