/**
 * Playwright API tests for the series date coverage the Event Signup form
 * shows before purchase (#1768): the viewer-context response describes each
 * upcoming date (label, full or not) and the dates a whole-series ticket
 * covers, and checkout keeps enforcing the same places it always did. The
 * same assertions run with fair-audience active and inactive. The suite is
 * single-worker, so fair-audience is back on before any other spec runs.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

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

const VIEWER_CONTEXT_PATH =
	'/wp-json/fair-events/v1/get-tickets/viewer-context';

const uniqueEmail = ( label ) =>
	`coverage-${ label }-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }@example.test`;

// Awaited rather than blocking, so pooled sockets are not left to go stale
// while WP-CLI runs.
async function wpCli( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', 'wp', ...args ],
		{ cwd: new URL( '../../../../', import.meta.url ), encoding: 'utf8' }
	);
	return stdout;
}

for ( const audienceActive of [ true, false ] ) {
	test.describe( `GetTicketsController — series date coverage (fair-audience ${
		audienceActive ? 'active' : 'inactive'
	})`, () => {
		let api;
		const createdPostIds = [];

		/**
		 * Create a post-linked event, optionally a series, with one place per
		 * date and free tickets of the given scopes.
		 *
		 * @param {Object}   options
		 * @param {string[]} options.scopes Ticket type scopes, in order.
		 * @param {string}   [options.rrule] Recurrence rule for a series.
		 * @return {Promise<{eventDateId: number, occurrenceIds: number[], typeIds: number[]}>} Created IDs.
		 */
		async function createEvent( { scopes, rrule } ) {
			const title = `Coverage ${ Date.now() } ${ Math.random() }`;
			const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
				headers: adminHeaders,
				data: { title, status: 'publish' },
			} );
			expect( postRes.ok() ).toBeTruthy();
			const postId = ( await postRes.json() ).id;
			createdPostIds.push( postId );

			const edRes = await api.post(
				'/wp-json/fair-events/v1/event-dates',
				{
					headers: adminHeaders,
					data: {
						title,
						link_type: 'post',
						start_datetime: '2036-02-07 10:00:00',
						end_datetime: '2036-02-07 12:00:00',
						...( rrule ? { rrule } : {} ),
					},
				}
			);
			const edBody = await edRes.json();
			expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
			const eventDateId = edBody.id;

			const linkRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders, data: { event_id: postId } }
			);
			expect( linkRes.ok() ).toBeTruthy();

			const ticketsRes = await api.put(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }/tickets`,
				{
					headers: adminHeaders,
					data: {
						capacity: 1,
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
						prices: scopes.map( ( _scope, index ) => ( {
							ticket_type_index: index,
							sale_period_index: 0,
							price: 0,
						} ) ),
						settings: {},
					},
				}
			);
			const ticketsBody = await ticketsRes.json();
			expect(
				ticketsRes.ok(),
				JSON.stringify( ticketsBody )
			).toBeTruthy();

			return {
				eventDateId,
				occurrenceIds: [
					eventDateId,
					...( edBody.generated_occurrences || [] ).map(
						( o ) => o.id
					),
				],
				typeIds: ticketsBody.ticket_types.map( ( type ) => type.id ),
			};
		}

		// Each purchase is a separate visitor, so no session links buyers.
		async function buy( data ) {
			const visitor = await request.newContext( { baseURL: BASE_URL } );
			const res = await visitor.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: { name: 'Coverage Buyer', _honeypot: '', ...data },
				}
			);
			const body = await res.json();
			await visitor.dispose();
			return { status: res.status(), body };
		}

		async function viewerContext( eventDateId, params = {} ) {
			const visitor = await request.newContext( { baseURL: BASE_URL } );
			const res = await visitor.get( VIEWER_CONTEXT_PATH, {
				params: { event_date_id: eventDateId, ...params },
			} );
			expect( res.ok() ).toBeTruthy();
			const body = await res.json();
			await visitor.dispose();
			return body;
		}

		test.beforeAll( async () => {
			if ( ! audienceActive ) {
				await wpCli(
					'plugin',
					'deactivate',
					'fair-audience-experimental',
					'fair-audience'
				);
			}
			api = await request.newContext( { baseURL: BASE_URL } );
		} );

		test.afterAll( async () => {
			for ( const postId of createdPostIds ) {
				await api.delete( `/wp-json/wp/v2/fair_event/${ postId }`, {
					headers: adminHeaders,
					params: { force: true },
				} );
			}
			await api.dispose();
			if ( ! audienceActive ) {
				await wpCli(
					'plugin',
					'activate',
					'fair-audience',
					'fair-audience-experimental'
				);
			}
		} );

		test( 'a date outside any series has no series coverage', async () => {
			const single = await createEvent( {
				scopes: [ 'single_instance' ],
			} );
			const body = await viewerContext( single.eventDateId );

			expect( body.series_coverage ).toBeNull();
		} );

		test( 'every response describes the dates, full ones included, and checkout keeps enforcing places', async () => {
			const series = await createEvent( {
				scopes: [
					'single_instance',
					'multiple_instances',
					'whole_series',
				],
				rrule: 'FREQ=WEEKLY;COUNT=3',
			} );
			const [ singleId, multipleId, wholeId ] = series.typeIds;
			const [ first, second, third ] = series.occurrenceIds;

			let body = await viewerContext( series.eventDateId );
			expect( body.series_coverage.dates.map( ( d ) => d.id ) ).toEqual( [
				first,
				second,
				third,
			] );
			expect( body.series_coverage.dates.map( ( d ) => d.full ) ).toEqual(
				[ false, false, false ]
			);
			// Formatted site-local, like the server-rendered pickers.
			expect( body.series_coverage.dates[ 0 ].label ).toContain( '2036' );
			expect( body.series_coverage.whole_series ).toEqual( [
				first,
				second,
				third,
			] );

			// Fill the second date with its only place.
			const filled = await buy( {
				event_date_id: second,
				ticket_type_id: singleId,
				email: uniqueEmail( 'single' ),
				quantity: 1,
			} );
			expect( filled.status, JSON.stringify( filled.body ) ).toBe( 200 );

			body = await viewerContext( series.eventDateId );
			expect( body.series_coverage.dates.map( ( d ) => d.full ) ).toEqual(
				[ false, true, false ]
			);
			// The form for another person gets the same fresh dates.
			const another = await viewerContext( series.eventDateId, {
				register_another_person: 1,
			} );
			expect( another.series_coverage ).toEqual( body.series_coverage );

			// The whole series still covers the full date, so it can't be bought.
			const whole = await buy( {
				event_date_id: series.eventDateId,
				ticket_type_id: wholeId,
				email: uniqueEmail( 'whole' ),
				quantity: 1,
			} );
			expect( whole.status ).toBe( 409 );
			expect( whole.body.code ).toBe( 'event_full' );

			// Selected dates including the full one are refused; without it they
			// are sold.
			const withFull = await buy( {
				event_date_id: series.eventDateId,
				ticket_type_id: multipleId,
				email: uniqueEmail( 'multiple-full' ),
				event_date_ids: [ first, second ],
			} );
			expect( withFull.status ).toBe( 409 );
			expect( withFull.body.code ).toBe( 'event_full' );

			const open = await buy( {
				event_date_id: series.eventDateId,
				ticket_type_id: multipleId,
				email: uniqueEmail( 'multiple-open' ),
				event_date_ids: [ first, third ],
			} );
			expect( open.status, JSON.stringify( open.body ) ).toBe( 200 );

			body = await viewerContext( series.eventDateId );
			expect( body.series_coverage.dates.map( ( d ) => d.full ) ).toEqual(
				[ true, true, true ]
			);
		} );
	} );
}
