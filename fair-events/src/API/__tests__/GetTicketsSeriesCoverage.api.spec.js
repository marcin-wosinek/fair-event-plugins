/**
 * Playwright API tests for the series date coverage the Event Signup form
 * shows before purchase (#1768): the viewer-context response describes each
 * upcoming date (label, full or not) and the dates a whole-series ticket
 * covers, and checkout keeps enforcing the same places it always did. The
 * same assertions run with fair-audience active and inactive. The suite is
 * single-worker, so fair-audience is back on before any other spec runs.
 *
 * The dates are read together whatever the series size (#1996): a WP-CLI
 * trace of the page render and the availability refresh counts the single
 * event date reads and the admission counts each one runs.
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

const SIGNUP_BLOCK = '<!-- wp:fair-events/event-signup /-->';
const GET_TICKETS_BLOCK = '<!-- wp:fair-events/get-tickets /-->';
const FIRST_DATE = '2036-02-07';

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

/**
 * The date of a weekly series' occurrence, counted from the first.
 *
 * @param {number} index Zero-based occurrence index.
 * @return {string} Y-m-d date.
 */
function weeklyDate( index ) {
	const date = new Date( `${ FIRST_DATE }T00:00:00Z` );
	date.setUTCDate( date.getUTCDate() + 7 * index );
	return date.toISOString().slice( 0, 10 );
}

/**
 * Trace the queries an event post's signup forms run, for its render (as
 * the series page, or an occurrence page with a date) and the refresh.
 *
 * @param {number} postId           Event post.
 * @param {number} eventDateId      Event date the refresh is for.
 * @param {string} [occurrenceDate] Y-m-d of the occurrence page.
 * @return {Promise<Object>} The script's E2E_COVERAGE_TRACE payload.
 */
async function traceCoverage( postId, eventDateId, occurrenceDate ) {
	const stdout = await wpCli(
		'eval-file',
		'wp-content/mu-plugins/scripts/series-coverage-query-trace.php',
		String( postId ),
		String( eventDateId ),
		...( occurrenceDate ? [ occurrenceDate ] : [] )
	);
	const line = stdout
		.split( '\n' )
		.find( ( row ) => row.startsWith( 'E2E_COVERAGE_TRACE:' ) );
	expect( line, stdout ).toBeTruthy();
	return JSON.parse( line.slice( 'E2E_COVERAGE_TRACE:'.length ) );
}

for ( const audienceActive of [ true, false ] ) {
	test.describe( `GetTicketsController — series date coverage (fair-audience ${
		audienceActive ? 'active' : 'inactive'
	})`, () => {
		let api;
		const createdPostIds = [];

		/**
		 * Create a post-linked event, optionally a series, with tickets of the
		 * given scopes.
		 *
		 * @param {Object}   options
		 * @param {string[]} options.scopes     Ticket type scopes, in order.
		 * @param {string}   [options.rrule]    Recurrence rule for a series.
		 * @param {?number}  [options.capacity] Places per date, null for no limit.
		 * @param {number}   [options.price]    Price of every ticket type.
		 * @param {string}   [options.content]  Post content.
		 * @return {Promise<{postId: number, eventDateId: number, occurrenceIds: number[], typeIds: number[]}>} Created IDs.
		 */
		async function createEvent( {
			scopes,
			rrule,
			capacity = 1,
			price = 0,
			content = '',
		} ) {
			const title = `Coverage ${ Date.now() } ${ Math.random() }`;
			const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
				headers: adminHeaders,
				data: { title, status: 'publish', content },
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
						start_date: FIRST_DATE,
						start_time: '10:00:00',
						end_date: FIRST_DATE,
						end_time: '12:00:00',
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
						capacity,
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
							price,
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
				postId,
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

		test( 'dates without a limit are never full', async () => {
			const series = await createEvent( {
				scopes: [ 'single_instance' ],
				rrule: 'FREQ=WEEKLY;COUNT=3',
				capacity: null,
			} );
			const [ , second ] = series.occurrenceIds;

			const bought = await buy( {
				event_date_id: second,
				ticket_type_id: series.typeIds[ 0 ],
				email: uniqueEmail( 'unlimited' ),
				quantity: 2,
			} );
			expect( bought.status, JSON.stringify( bought.body ) ).toBe( 200 );

			const body = await viewerContext( series.eventDateId );
			expect( body.series_coverage.dates.map( ( d ) => d.full ) ).toEqual(
				[ false, false, false ]
			);
		} );

		test( 'a payment hold fills its date until it lapses', async () => {
			const series = await createEvent( {
				scopes: [ 'single_instance' ],
				rrule: 'FREQ=WEEKLY;COUNT=3',
				price: 10,
			} );
			const [ , second ] = series.occurrenceIds;
			const email = uniqueEmail( 'hold' );

			const held = await buy( {
				event_date_id: second,
				ticket_type_id: series.typeIds[ 0 ],
				email,
				quantity: 1,
			} );
			expect( held.status, JSON.stringify( held.body ) ).toBe( 200 );

			let body = await viewerContext( series.eventDateId );
			expect( body.series_coverage.dates.map( ( d ) => d.full ) ).toEqual(
				[ false, true, false ]
			);

			const signupsRes = await api.get(
				'/wp-json/fair-events/v1/get-tickets',
				{ headers: adminHeaders, params: { event_date: second } }
			);
			expect( signupsRes.ok() ).toBeTruthy();
			const signup = ( await signupsRes.json() ).find(
				( row ) => row.email === email
			);
			expect( signup.status ).toBe( 'pending_payment' );

			const lapseRes = await api.post(
				'/wp-json/fair-e2e/v1/ticket-capacity/lapse',
				{ headers: adminHeaders, data: { signup_id: signup.id } }
			);
			expect( lapseRes.ok() ).toBeTruthy();

			// The next refresh counts afresh: nothing is cached across requests.
			body = await viewerContext( series.eventDateId );
			expect( body.series_coverage.dates.map( ( d ) => d.full ) ).toEqual(
				[ false, false, false ]
			);
		} );

		test( "the viewer's own dates are marked while fair-audience recognises them", async () => {
			const series = await createEvent( {
				scopes: [ 'single_instance' ],
				rrule: 'FREQ=WEEKLY;COUNT=3',
				capacity: null,
			} );
			const [ , second ] = series.occurrenceIds;

			// One visitor buys, then refreshes the series form in the same
			// browser session.
			const visitor = await request.newContext( { baseURL: BASE_URL } );
			const res = await visitor.post(
				'/wp-json/fair-events/v1/get-tickets',
				{
					data: {
						name: 'Coverage Buyer',
						_honeypot: '',
						event_date_id: second,
						ticket_type_id: series.typeIds[ 0 ],
						email: uniqueEmail( 'own' ),
						quantity: 1,
					},
				}
			);
			const bought = await res.json();
			expect( res.status(), JSON.stringify( bought ) ).toBe( 200 );

			const refresh = await visitor.get( VIEWER_CONTEXT_PATH, {
				params: { event_date_id: series.eventDateId },
			} );
			expect( refresh.ok() ).toBeTruthy();
			const body = await refresh.json();
			await visitor.dispose();

			expect(
				body.series_coverage.dates.map( ( d ) => d.signed_up )
			).toEqual( [ false, audienceActive, false ] );
			expect( body.series_coverage.whole_series ).toEqual(
				series.occurrenceIds
			);
		} );

		test( 'coverage reads the dates together, so its date reads do not grow with the series (#1996)', async () => {
			test.setTimeout( 240_000 );

			const layouts = {
				one: SIGNUP_BLOCK,
				two: SIGNUP_BLOCK + GET_TICKETS_BLOCK,
			};
			const traces = [];
			for ( const capacity of [ null, 5 ] ) {
				for ( const count of [ 3, 48 ] ) {
					for ( const [ layout, content ] of Object.entries(
						layouts
					) ) {
						const series = await createEvent( {
							scopes: [ 'multiple_instances' ],
							rrule: `FREQ=WEEKLY;COUNT=${ count }`,
							capacity,
							content,
						} );
						const occurrence = Math.floor( count / 2 );
						const pages = {
							series: await traceCoverage(
								series.postId,
								series.eventDateId
							),
							occurrence: await traceCoverage(
								series.postId,
								series.occurrenceIds[ occurrence ],
								weeklyDate( occurrence )
							),
						};
						for ( const trace of Object.values( pages ) ) {
							expect( trace.status ).toBe( 200 );
							expect( trace.forms ).toBe(
								'one' === layout ? 1 : 2
							);
							expect(
								trace.coverage.dates.map( ( d ) => d.id )
							).toEqual( series.occurrenceIds );
						}
						traces.push( { capacity, count, layout, pages } );
					}
				}
			}

			// Compare each page of a 48-date series with the same page of a
			// 3-date one.
			const find = ( capacity, count, layout ) =>
				traces.find(
					( t ) =>
						t.capacity === capacity &&
						t.count === count &&
						t.layout === layout
				).pages;
			for ( const capacity of [ null, 5 ] ) {
				for ( const layout of Object.keys( layouts ) ) {
					const small = find( capacity, 3, layout );
					const large = find( capacity, 48, layout );
					for ( const page of [ 'series', 'occurrence' ] ) {
						for ( const phase of [ 'render', 'refresh' ] ) {
							const before = small[ page ][ phase ];
							const after = large[ page ][ phase ];
							const where = `${ capacity } places, ${ layout } form(s), ${ page } ${ phase }`;

							// No event date is read one by one per occurrence.
							expect( after.date_reads, where ).toBe(
								before.date_reads
							);
							if ( null === capacity ) {
								// Unlimited dates count no admissions at all.
								expect( after.admission_counts, where ).toBe(
									0
								);
								expect( after.total, where ).toBe(
									before.total
								);
							} else {
								// Limited dates still count fresh, once per date.
								expect(
									after.admission_counts / 48,
									where
								).toBe( before.admission_counts / 3 );
							}
						}
					}
				}
			}
		} );
	} );
}
