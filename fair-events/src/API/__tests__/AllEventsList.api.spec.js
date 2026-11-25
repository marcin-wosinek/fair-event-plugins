/**
 * Playwright API tests for the grouped all-events list endpoint on
 * EventDatesController.
 *
 * Exercises GET /fair-events/v1/event-dates/all against a live WordPress
 * instance (#1202): generated series dates are nested under their master
 * instead of appearing as independent top-level rows.
 */

import { test, expect, request } from '@playwright/test';
import { startOf } from '../../../../e2e/support/event-timing.js';

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

test.describe( 'EventDatesController — grouped all-events list', () => {
	let api;
	let seriesTitle;
	let masterEventDateId;
	let generatedIds;
	let singleEventDateId;
	let sourceEventId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		seriesTitle = `Nesting series test ${ Date.now() }`;
		const masterRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: seriesTitle,
					start_date: '2037-02-01',
					start_time: '10:00:00',
					end_date: '2037-02-01',
					end_time: '12:00:00',
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect( masterRes.ok() ).toBeTruthy();
		const masterBody = await masterRes.json();
		masterEventDateId = masterBody.id;
		generatedIds = masterBody.generated_occurrences.map( ( o ) => o.id );
		expect( generatedIds.length ).toBe( 2 );

		const sourceRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Copy source ${ Date.now() }`, status: 'publish' },
		} );
		expect( sourceRes.ok() ).toBeTruthy();
		sourceEventId = ( await sourceRes.json() ).id;
		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{
				headers: adminHeaders,
				data: { event_id: sourceEventId },
			}
		);
		expect( linkRes.ok() ).toBeTruthy();

		const singleRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Nesting single test ${ Date.now() }`,
					start_date: '2037-03-01',
					start_time: '10:00:00',
				},
			}
		);
		expect( singleRes.ok() ).toBeTruthy();
		singleEventDateId = ( await singleRes.json() ).id;
	} );

	test.afterAll( async () => {
		if ( masterEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( singleEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ singleEventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( sourceEventId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ sourceEventId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'generated occurrences are absent from the top level, master carries children ordered by date ascending', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/event-dates/all?per_page=100',
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		const ids = body.map( ( item ) => item.id );
		generatedIds.forEach( ( id ) => expect( ids ).not.toContain( id ) );
		expect( ids ).toContain( masterEventDateId );
		expect( ids ).toContain( singleEventDateId );

		const master = body.find( ( item ) => item.id === masterEventDateId );
		expect( master.occurrence_type ).toBe( 'master' );
		expect( master.post.status ).toBe( 'publish' );
		expect( master.post.status_label ).toBe( 'Published' );
		expect( master.children_count ).toBe( 2 );
		expect( master.children.map( ( c ) => c.id ) ).toEqual( generatedIds );
		expect(
			new Date( startOf( master.children[ 0 ] ) ).getTime()
		).toBeLessThan( new Date( startOf( master.children[ 1 ] ) ).getTime() );
		expect( master.copy_url ).toMatch(
			new RegExp(
				`/wp-admin/admin\\.php\\?page=fair-events-copy&event_date_id=${ masterEventDateId }&_wpnonce=[^&]+`
			)
		);
		master.children.forEach( ( child ) => {
			expect( child.copy_url ).toMatch(
				new RegExp(
					`event_date_id=${ masterEventDateId }&_wpnonce=[^&]+`
				)
			);
		} );
		const calendarOnly = body.find(
			( item ) => item.id === singleEventDateId
		);
		expect( calendarOnly.copy_url ).toMatch(
			new RegExp( `event_date_id=${ singleEventDateId }&_wpnonce=[^&]+` )
		);
	} );

	test( 'X-WP-Total counts top-level rows only', async () => {
		const resFiltered = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?search=${ encodeURIComponent(
				seriesTitle
			) }`,
			{ headers: adminHeaders }
		);
		expect( resFiltered.ok() ).toBeTruthy();
		const bodyFiltered = await resFiltered.json();
		const totalFiltered = Number.parseInt(
			resFiltered.headers()[ 'x-wp-total' ] || '0',
			10
		);

		// Only the master matches the search title at the top level; its
		// generated children (which share no title of their own) don't add
		// to the count.
		expect( totalFiltered ).toBe( 1 );
		expect( bodyFiltered.length ).toBe( 1 );
		expect( bodyFiltered[ 0 ].id ).toBe( masterEventDateId );
	} );

	test( 'occurrence_type=generated filter still returns a flat list', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/event-dates/all?occurrence_type=generated&per_page=100',
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		const ids = body.map( ( item ) => item.id );
		generatedIds.forEach( ( id ) => expect( ids ).toContain( id ) );
		body.forEach( ( item ) => {
			expect( item.occurrence_type ).toBe( 'generated' );
			expect( item.children ).toBeUndefined();
		} );
	} );

	test( 'search matches masters', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?search=${ encodeURIComponent(
				seriesTitle
			) }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		expect( body.length ).toBe( 1 );
		expect( body[ 0 ].id ).toBe( masterEventDateId );
		expect( body[ 0 ].occurrence_type ).toBe( 'master' );
	} );
} );

/*
 * Query hardening for the all-events list (#2382): sorting identifiers and
 * directions are fixed SQL bound with %i, and filters/pagination are bound
 * values. These cases pin down the observable listing contract around that.
 */
test.describe( 'EventDatesController — all-events list query safety', () => {
	const USER_PASSWORD = 'listing-safety-password';
	const run = Date.now();
	const prefix = `Listing safety ${ run }`;
	const list = '/wp-json/fair-events/v1/event-dates/all';

	let api;
	let venueId;
	const ids = {};
	let generatedIds;
	const userIds = [];

	const basicAuth = ( user, password ) => ( {
		Authorization:
			'Basic ' +
			Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
	} );

	const createDate = async ( key, data ) => {
		const res = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: { title: `${ prefix } ${ key }`, ...data },
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		const body = await res.json();
		ids[ key ] = body.id;
		return body;
	};

	const fetchList = async ( params, headers = adminHeaders ) => {
		const query = new URLSearchParams( params ).toString();
		return api.get( `${ list }?${ query }`, { headers } );
	};

	const listIds = async ( params ) => {
		const res = await fetchList( { search: prefix, ...params } );
		expect( res.status(), await res.text() ).toBe( 200 );
		const body = await res.json();
		return {
			body,
			ids: body.map( ( item ) => item.id ),
			total: Number.parseInt( res.headers()[ 'x-wp-total' ], 10 ),
			totalPages: Number.parseInt(
				res.headers()[ 'x-wp-totalpages' ],
				10
			),
		};
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const venueRes = await api.post( '/wp-json/fair-events/v1/venues', {
			headers: adminHeaders,
			data: { name: `${ prefix } venue` },
		} );
		expect( venueRes.ok() ).toBeTruthy();
		venueId = ( await venueRes.json() ).id;

		// Same day, different times: the later one is created first so id
		// order and time order disagree.
		await createDate( 'alpha', {
			start_date: '2038-05-01',
			start_time: '14:00:00',
		} );
		await createDate( 'bravo', {
			start_date: '2038-05-01',
			start_time: '09:00:00',
		} );
		await createDate( 'charlie', {
			start_date: '2038-05-02',
			start_time: '10:00:00',
			venue_id: venueId,
			link_type: 'external',
			external_url: 'https://example.com/listing-safety',
		} );
		// Literal LIKE wildcards in the title.
		await createDate( '100%_off', {
			start_date: '2038-05-03',
			start_time: '10:00:00',
		} );
		const master = await createDate( 'series', {
			start_date: '2038-05-04',
			start_time: '10:00:00',
			end_date: '2038-05-04',
			end_time: '12:00:00',
			venue_id: venueId,
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		generatedIds = master.generated_occurrences.map( ( o ) => o.id );
		expect( generatedIds.length ).toBe( 2 );
	} );

	test.afterAll( async () => {
		for ( const id of Object.values( ids ) ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		if ( venueId ) {
			await api.delete( `/wp-json/fair-events/v1/venues/${ venueId }`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of userIds ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ id }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'start_date sorts both directions with same-day dates ordered by time', async () => {
		const byDate = [
			ids.bravo,
			ids.alpha,
			ids.charlie,
			ids[ '100%_off' ],
			ids.series,
		];

		const asc = await listIds( { orderby: 'start_date', order: 'asc' } );
		expect( asc.ids ).toEqual( byDate );

		const desc = await listIds( { orderby: 'start_date', order: 'desc' } );
		expect( desc.ids ).toEqual( [ ...byDate ].reverse() );

		// The default sort is start_date descending.
		expect( ( await listIds( {} ) ).ids ).toEqual( desc.ids );
	} );

	test( 'title sorts both directions', async () => {
		const byTitle = [
			ids[ '100%_off' ],
			ids.alpha,
			ids.bravo,
			ids.charlie,
			ids.series,
		];

		const asc = await listIds( { orderby: 'title', order: 'asc' } );
		expect( asc.ids ).toEqual( byTitle );

		const desc = await listIds( { orderby: 'title', order: 'desc' } );
		expect( desc.ids ).toEqual( [ ...byTitle ].reverse() );
	} );

	test( 'pages split the top-level rows, totals ignore children, and children stay with their master', async () => {
		const pages = [];
		for ( const page of [ 1, 2, 3 ] ) {
			const result = await listIds( {
				orderby: 'start_date',
				order: 'asc',
				per_page: 2,
				page,
			} );
			expect( result.total ).toBe( 5 );
			expect( result.totalPages ).toBe( 3 );
			pages.push( result );
		}

		expect( pages.map( ( p ) => p.ids ) ).toEqual( [
			[ ids.bravo, ids.alpha ],
			[ ids.charlie, ids[ '100%_off' ] ],
			[ ids.series ],
		] );
		const master = pages[ 2 ].body[ 0 ];
		expect( master.children_count ).toBe( 2 );
		expect( master.children.map( ( c ) => c.id ) ).toEqual( generatedIds );
		pages
			.flatMap( ( p ) => p.ids )
			.forEach( ( id ) => {
				expect( generatedIds ).not.toContain( id );
			} );

		const beyond = await listIds( { per_page: 2, page: 4 } );
		expect( beyond.ids ).toEqual( [] );
		expect( beyond.total ).toBe( 5 );
	} );

	test( 'filters combine', async () => {
		const atVenue = await listIds( {
			venue_id: String( venueId ),
			order: 'asc',
		} );
		expect( atVenue.ids ).toEqual( [ ids.charlie, ids.series ] );
		expect( atVenue.total ).toBe( 2 );

		const noVenue = await listIds( { venue_id: 'none', order: 'asc' } );
		expect( noVenue.ids ).toEqual( [
			ids.bravo,
			ids.alpha,
			ids[ '100%_off' ],
		] );

		const external = await listIds( {
			link_type: 'external',
			venue_id: String( venueId ),
		} );
		expect( external.ids ).toEqual( [ ids.charlie ] );

		const masters = await listIds( {
			occurrence_type: 'master',
			venue_id: String( venueId ),
		} );
		expect( masters.ids ).toEqual( [ ids.series ] );
		expect( masters.body[ 0 ].children_count ).toBe( 2 );

		const none = await listIds( {
			link_type: 'external',
			venue_id: 'none',
		} );
		expect( none.ids ).toEqual( [] );
		expect( none.total ).toBe( 0 );
	} );

	test( 'occurrence_type=generated lists the generated dates flat', async () => {
		const res = await fetchList( {
			// Generated rows inherit their venue rather than storing it, so
			// find this run's rows among the newest ids instead.
			occurrence_type: 'generated',
			orderby: 'id',
			order: 'desc',
			per_page: 100,
		} );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		const generated = body.filter( ( item ) =>
			generatedIds.includes( item.id )
		);
		expect( generated.map( ( item ) => item.id ) ).toEqual(
			[ ...generatedIds ].reverse()
		);
		body.forEach( ( item ) => {
			expect( item.occurrence_type ).toBe( 'generated' );
			expect( item.children ).toBeUndefined();
		} );
	} );

	test( 'search treats punctuation and SQL as literal text', async () => {
		const literal = await listIds( { search: `${ prefix } 100%_off` } );
		expect( literal.ids ).toEqual( [ ids[ '100%_off' ] ] );

		// `_` and `%` are not wildcards: neither matches "alpha".
		for ( const search of [
			`${ prefix } _lpha`,
			`${ prefix } %pha`,
			`${ prefix }' OR '1'='1`,
			`${ prefix }%' OR 1=1 -- `,
			`${ prefix }") UNION SELECT 1 -- `,
		] ) {
			const result = await listIds( { search } );
			expect( result.ids, search ).toEqual( [] );
			expect( result.total, search ).toBe( 0 );
		}
	} );

	test( 'malformed parameters are rejected with 400', async () => {
		const malformed = [
			{ orderby: 'title; DROP TABLE wp_fair_event_dates' },
			{ orderby: 'start_time' },
			{ orderby: '(SELECT 1)' },
			{ order: 'asc, id' },
			{ order: 'ASC LIMIT 1' },
			{ page: '0' },
			{ page: 'abc' },
			{ per_page: '0' },
			{ per_page: '101' },
			{ per_page: '1 OR 1=1' },
			{ venue_id: '1 OR 1=1' },
			{ venue_id: '-1' },
			{ link_type: "none' OR '1'='1" },
			{ occurrence_type: 'generated OR 1=1' },
		];

		for ( const params of malformed ) {
			const res = await fetchList( params );
			expect( res.status(), JSON.stringify( params ) ).toBe( 400 );
		}
	} );

	test( 'requires a logged-in user who can edit posts', async () => {
		const anonymous = await api.get( `${ list }?search=${ run }` );
		expect( anonymous.status() ).toBe( 401 );

		const login = `listing-safety-${ run }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password: USER_PASSWORD,
				roles: [ 'subscriber' ],
			},
		} );
		expect( userRes.ok(), await userRes.text() ).toBeTruthy();
		userIds.push( ( await userRes.json() ).id );

		const subscriber = await fetchList(
			{ search: prefix },
			basicAuth( login, USER_PASSWORD )
		);
		expect( subscriber.status() ).toBe( 403 );
	} );
} );
