/**
 * Statistics on installations where Fair Audience, and in the first case
 * Fair Payments Connector too, were never installed (#2112).
 *
 * Deactivating plugins on the shared tests site leaves their tables and
 * history behind, so each describe block installs its own WordPress in the
 * same database (e2e/drop-ins/db.php, e2e/support/fresh-site.js) and
 * activates only the plugins it names. The spec checks that nothing of the
 * other plugins exists there before it reads Statistics.
 *
 * - Fair Events alone: tickets, activities and capacity come from Fair
 *   Events; revenue is `unavailable` with null amounts, never 0.
 * - Fair Events + Connector: revenue is read from Connector without Fair
 *   Audience: 0 for an event without paid sales, the paid allocation
 *   otherwise.
 *
 * Both route namespaces answer the same, and the administrator-only
 * permissions and the unknown-date 404 are unchanged. No payment history
 * activation is involved (#2251).
 */

import { test, expect, request } from '@playwright/test';
import {
	installFreshSite,
	dropFreshSite,
} from '../../../../e2e/support/fresh-site.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const SUBSCRIBER_PASSWORD = 'fresh-install-subscriber';
const NAMESPACES = [ 'fair-events/v1', 'fair-audience/v1' ];

const basicAuth = ( user, password ) => ( {
	Authorization: `Basic ${ Buffer.from( `${ user }:${ password }` ).toString(
		'base64'
	) }`,
} );

function siteLocal( daysAgo ) {
	const value = new Date();
	value.setUTCDate( value.getUTCDate() - daysAgo );
	return `${ value.toISOString().slice( 0, 10 ) } 12:00:00`;
}

/**
 * A populated event: capacity limits, two activities and three confirmed
 * tickets in two purchases, the first one paid 50.
 *
 * @param {Object} site Fresh site helpers.
 * @return {Promise<Object>} The seeded event and fixture ids.
 */
async function seedPopulated( site ) {
	const event = await site.seedEvent( 'paid' );
	const seeded = await site.seed( {
		eventDateId: event.eventDateId,
		ticketTypeId: event.ticketTypeId,
		eventCapacity: 10,
		ticketCapacity: 8,
		activities: [ { name: 'Yoga', capacity: 5 }, { name: 'Dance' } ],
		purchases: [
			{
				quantity: 2,
				createdAt: siteLocal( 3 ),
				activities: [ 0, 1 ],
				paid: 50,
			},
			{ quantity: 1, createdAt: siteLocal( 2 ), activities: [ 0 ] },
		],
	} );
	return { ...event, ...seeded };
}

function expectTicketFigures( body ) {
	expect( body ).not.toHaveProperty( 'payment_readers' );
	expect( body.total_tickets ).toBe( 3 );
	expect( body.tickets_per_activity ).toEqual( [
		{ id: expect.any( Number ), name: 'Yoga', count: 2 },
		{ id: expect.any( Number ), name: 'Dance', count: 1 },
	] );
	expect( body.activities_per_ticket ).toEqual( [
		{ activities: 0, tickets: 0 },
		{ activities: 1, tickets: 3 },
	] );
	expect( body.event_capacity ).toEqual( {
		taken: 3,
		capacity: 10,
		remaining: 7,
		over: 0,
	} );
	expect( body.ticket_type_capacity ).toEqual( [
		expect.objectContaining( {
			taken: 3,
			capacity: 8,
			remaining: 5,
			over: 0,
		} ),
	] );
	expect( body.activity_capacity ).toEqual( [
		expect.objectContaining( {
			name: 'Yoga',
			taken: 2,
			capacity: 5,
			remaining: 3,
		} ),
		expect.objectContaining( {
			name: 'Dance',
			taken: 1,
			capacity: null,
			remaining: null,
		} ),
	] );
	// The cumulative ticket chart reaches the three tickets.
	const totals = body.series
		.map( ( point ) => point.total )
		.filter( ( total ) => total !== null );
	expect( Math.max( ...totals ) ).toBe( 3 );
}

async function statistics( api, eventDateId, namespace = NAMESPACES[ 0 ] ) {
	const response = await api.get(
		`/wp-json/${ namespace }/event-dates/${ eventDateId }/statistics`
	);
	expect( response.status() ).toBe( 200 );
	return response.json();
}

for ( const combination of [
	{
		site: 'events-only',
		plugins: [ 'fair-events' ],
		connector: false,
	},
	{
		site: 'events-connector',
		plugins: [ 'fair-events', 'fair-payments-connector' ],
		connector: true,
	},
] ) {
	test.describe
		.serial( `Statistics on a fresh install with ${ combination.plugins.join(
		' + '
	) }`, () => {
		test.describe.configure( { timeout: 240 * 1000 } );

		let site;
		let admin;
		let subscriber;
		let anonymous;

		test.beforeAll( async () => {
			site = await installFreshSite(
				combination.site,
				combination.plugins
			);
			await site.wp( [
				'user',
				'create',
				'fresh-subscriber',
				'fresh-subscriber@example.test',
				'--role=subscriber',
				`--user_pass=${ SUBSCRIBER_PASSWORD }`,
			] );
			const context = ( headers ) =>
				request.newContext( {
					baseURL: BASE_URL,
					extraHTTPHeaders: { ...site.headers, ...headers },
				} );
			admin = await context( basicAuth( ADMIN_USER, ADMIN_PASSWORD ) );
			subscriber = await context(
				basicAuth( 'fresh-subscriber', SUBSCRIBER_PASSWORD )
			);
			anonymous = await context( {} );
		} );

		test.afterAll( async () => {
			await admin?.dispose();
			await subscriber?.dispose();
			await anonymous?.dispose();
			await dropFreshSite( combination.site );
		} );

		test( 'starts with no trace of the plugins it never activated', async () => {
			const state = await site.state();

			expect( state.prefix ).toMatch( /^e2efresh_/ );
			expect( state.activePlugins.sort() ).toEqual(
				combination.plugins
					.map( ( slug ) => `${ slug }/${ slug }.php` )
					.sort()
			);
			expect( state.audienceTables ).toEqual( [] );
			expect( state.audienceOptions ).toEqual( [] );
			if ( combination.connector ) {
				expect( state.connectorTables ).toContain(
					`${ state.prefix }fair_payment_transactions`
				);
			} else {
				expect( state.connectorTables ).toEqual( [] );
				expect( state.connectorOptions ).toEqual( [] );
			}
		} );

		test( 'reports an empty event, with revenue unavailable or zero', async () => {
			const event = await site.seedEvent( 'free' );
			const body = await statistics( admin, event.eventDateId );

			expect( body ).not.toHaveProperty( 'payment_readers' );
			expect( body.total_tickets ).toBe( 0 );
			expect( body.tickets_per_activity ).toEqual( [] );
			expect( body.event_capacity ).toEqual( {
				taken: 0,
				capacity: null,
				remaining: null,
				over: 0,
			} );
			expect( body.activity_capacity ).toEqual( [] );
			const amounts = body.amount_series.map( ( point ) => point.amount );
			if ( combination.connector ) {
				expect( body.revenue_state ).toBe( 'available' );
				expect( body.total_sales_amount ).toBe( 0 );
				expect( amounts.some( ( amount ) => amount === 0 ) ).toBe(
					true
				);
			} else {
				expect( body.revenue_state ).toBe( 'unavailable' );
				expect( body.total_sales_amount ).toBeNull();
				expect( amounts.every( ( amount ) => amount === null ) ).toBe(
					true
				);
			}
		} );

		test( 'counts tickets, activities, capacity and revenue from its own records', async () => {
			const event = await seedPopulated( site );
			const responses = [];
			for ( const namespace of NAMESPACES ) {
				responses.push(
					await statistics( admin, event.eventDateId, namespace )
				);
			}
			const [ body, legacy ] = responses;

			expect( legacy ).toEqual( body );
			expectTicketFigures( body );
			if ( combination.connector ) {
				expect( event.transactionIds ).toHaveLength( 1 );
				expect( body.revenue_state ).toBe( 'available' );
				expect( body.total_sales_amount ).toBe( 50 );
				const amounts = body.amount_series
					.map( ( point ) => point.amount )
					.filter( ( amount ) => amount !== null );
				expect( Math.max( ...amounts ) ).toBe( 50 );
			} else {
				expect( event.transactionIds ).toEqual( [] );
				expect( body.revenue_state ).toBe( 'unavailable' );
				expect( body.total_sales_amount ).toBeNull();
			}
		} );

		test( 'keeps Statistics for administrators only', async () => {
			const event = await site.seedEvent( 'free' );
			for ( const namespace of NAMESPACES ) {
				const path = `/wp-json/${ namespace }/event-dates/${ event.eventDateId }/statistics`;
				expect( ( await anonymous.get( path ) ).status() ).toBe( 401 );
				expect( ( await subscriber.get( path ) ).status() ).toBe( 403 );
				const missing = await admin.get(
					`/wp-json/${ namespace }/event-dates/999999/statistics`
				);
				expect( missing.status() ).toBe( 404 );
				expect( ( await missing.json() ).code ).toBe(
					'event_date_not_found'
				);
			}
		} );
	} );
}
