/**
 * Playwright API tests for the venue_id filter on the grouped all-events
 * list endpoint (#1600).
 *
 * Exercises GET /fair-events/v1/event-dates/all?venue_id=... against a live
 * WordPress instance: a venue narrows the list to events/series whose own
 * top-level location matches it, "none" narrows it to events with no venue,
 * and the filter composes with search and occurrence_type.
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

test.describe( 'EventDatesController — venue_id filter', () => {
	let api;
	let venueId;
	let placedEventDateId;
	let placedSeriesTitle;
	let masterEventDateId;
	let generatedIds;
	let unplacedEventDateId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const venueRes = await api.post( '/wp-json/fair-events/v1/venues', {
			headers: adminHeaders,
			data: { name: `Venue filter test ${ Date.now() }` },
		} );
		expect( venueRes.ok() ).toBeTruthy();
		venueId = ( await venueRes.json() ).id;

		const placedRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Venue filter placed event ${ Date.now() }`,
					start_datetime: '2037-04-01 10:00:00',
					venue_id: venueId,
				},
			}
		);
		expect( placedRes.ok() ).toBeTruthy();
		placedEventDateId = ( await placedRes.json() ).id;

		placedSeriesTitle = `Venue filter placed series ${ Date.now() }`;
		const masterRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: placedSeriesTitle,
					start_datetime: '2037-04-08 10:00:00',
					end_datetime: '2037-04-08 12:00:00',
					venue_id: venueId,
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect( masterRes.ok() ).toBeTruthy();
		const masterBody = await masterRes.json();
		masterEventDateId = masterBody.id;
		generatedIds = masterBody.generated_occurrences.map( ( o ) => o.id );

		const unplacedRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Venue filter unplaced event ${ Date.now() }`,
					start_datetime: '2037-04-15 10:00:00',
				},
			}
		);
		expect( unplacedRes.ok() ).toBeTruthy();
		unplacedEventDateId = ( await unplacedRes.json() ).id;
	} );

	test.afterAll( async () => {
		if ( placedEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ placedEventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( masterEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( unplacedEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ unplacedEventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( venueId ) {
			await api.delete( `/wp-json/fair-events/v1/venues/${ venueId }`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'venue_id=<id> returns only the rows placed at that venue, X-WP-Total agrees, and the master keeps its children', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?venue_id=${ venueId }&per_page=100`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		const total = parseInt( res.headers()[ 'x-wp-total' ] || '0', 10 );

		const ids = body.map( ( item ) => item.id );
		expect( ids.sort() ).toEqual(
			[ placedEventDateId, masterEventDateId ].sort()
		);
		expect( total ).toBe( 2 );

		const master = body.find( ( item ) => item.id === masterEventDateId );
		expect( master.children_count ).toBe( 2 );
		expect( master.children.map( ( c ) => c.id ) ).toEqual( generatedIds );
	} );

	test( 'venue_id=none includes the unplaced event and excludes the placed ones', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/event-dates/all?venue_id=none&per_page=100',
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		const ids = body.map( ( item ) => item.id );
		expect( ids ).toContain( unplacedEventDateId );
		expect( ids ).not.toContain( placedEventDateId );
		expect( ids ).not.toContain( masterEventDateId );
	} );

	test( 'venue_id composes with search', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?venue_id=${ venueId }&search=${ encodeURIComponent(
				placedSeriesTitle
			) }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		expect( body.length ).toBe( 1 );
		expect( body[ 0 ].id ).toBe( masterEventDateId );
	} );

	test( 'venue_id composes with occurrence_type', async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/all?venue_id=${ venueId }&occurrence_type=single`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		const ids = body.map( ( item ) => item.id );
		expect( ids ).toEqual( [ placedEventDateId ] );
	} );

	test( 'an invalid venue_id is rejected', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/event-dates/all?venue_id=not-a-number',
			{ headers: adminHeaders }
		);
		expect( res.status() ).toBe( 400 );
	} );
} );
