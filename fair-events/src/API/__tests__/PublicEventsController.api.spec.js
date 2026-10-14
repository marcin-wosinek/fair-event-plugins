/**
 * Playwright API tests for PublicEventsController's handling of generated
 * occurrences on a post-linked recurring event (#1090).
 *
 * Generated occurrence rows don't inherit `event_id` from their master, so
 * the public events feed used to leave `url: ""` for every occurrence after
 * the first. These tests assert the feed resolves the link through the
 * master's linked post instead.
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

test.describe( 'PublicEventsController — recurring post-linked occurrences', () => {
	let api;
	let eventPostId;
	let occurrenceIds;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Public feed recurring post-link test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Public feed recurring post-link test ${ Date.now() }`,
				link_type: 'post',
				start_datetime: '2035-07-01 10:00:00',
				end_datetime: '2035-07-01 12:00:00',
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		const masterId = ( await edRes.json() ).id;

		// Link to the post and set the rrule in one PUT — this is the update
		// path that actually regenerates occurrences (see
		// EventDatesController::update_item()); the create endpoint doesn't
		// wire event_id through.
		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ masterId }`,
			{
				headers: adminHeaders,
				data: {
					event_id: eventPostId,
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect( linkRes.ok() ).toBeTruthy();
		const linkBody = await linkRes.json();
		expect( linkBody.generated_occurrences.length ).toBe( 2 );

		occurrenceIds = [
			masterId,
			...linkBody.generated_occurrences.map( ( o ) => o.id ),
		].sort( ( a, b ) => a - b );
	} );

	test.afterAll( async () => {
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
		}
	} );

	test( 'generated occurrences get a non-empty, resolvable url', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-07-01&end_date=2035-07-31&per_page=500'
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		const eventsForOccurrences = occurrenceIds.map( ( occurrenceId ) =>
			body.events.find( ( e ) => e.event_date_id === occurrenceId )
		);

		for ( const event of eventsForOccurrences ) {
			expect( event ).toBeTruthy();
			expect( event.url ).toBeTruthy();
			expect( event.uid.startsWith( 'fair_event_' ) ).toBe( true );

			// Canonical URL form: every session in the feed, including the
			// master (the series' first session, #1884), carries the
			// `?event_date=` disambiguator with a Y-m-d date (not the
			// numeric event_date id — see OccurrenceDateParam), so the
			// plain permalink stays the series overview (see
			// EventDates::get_display_url()).
			expect( event.url ).toMatch( /event_date=\d{4}-\d{2}-\d{2}/ );
		}
	} );

	test( 'feed url matches the resolver display_url for each occurrence', async () => {
		const feedRes = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-07-01&end_date=2035-07-31&per_page=500'
		);
		expect( feedRes.ok() ).toBeTruthy();
		const feedBody = await feedRes.json();

		for ( const occurrenceId of occurrenceIds ) {
			const edRes = await api.get(
				`/wp-json/fair-events/v1/event-dates/${ occurrenceId }`,
				{ headers: adminHeaders }
			);
			expect( edRes.ok() ).toBeTruthy();
			const eventDate = await edRes.json();

			const feedEvent = feedBody.events.find(
				( e ) => e.event_date_id === occurrenceId
			);

			expect( feedEvent ).toBeTruthy();

			// The master's display_url is the series overview; the feed
			// links it to its own session instead (#1884).
			let expectedUrl = eventDate.display_url;
			if ( 'master' === eventDate.occurrence_type ) {
				const url = new URL( eventDate.display_url );
				url.searchParams.set( 'event_date', '2035-07-01' );
				expectedUrl = url.toString();
			}
			expect( feedEvent.url ).toBe( expectedUrl );
		}
	} );
} );

test.describe( 'PublicEventsController — standalone events', () => {
	let api;
	let eventDateId;
	let categoryId;
	let otherCategoryId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const categoryRes = await api.post( '/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Public feed standalone test ${ Date.now() }` },
		} );
		expect( categoryRes.ok() ).toBeTruthy();
		categoryId = ( await categoryRes.json() ).id;

		const otherCategoryRes = await api.post( '/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Public feed standalone unused ${ Date.now() }` },
		} );
		expect( otherCategoryRes.ok() ).toBeTruthy();
		otherCategoryId = ( await otherCategoryRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Public feed standalone test ${ Date.now() }`,
				start_datetime: '2035-08-01 10:00:00',
				end_datetime: '2035-08-01 12:00:00',
				link_type: 'external',
				external_url: 'https://example.com/standalone-test',
				categories: [ categoryId ],
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		eventDateId = ( await edRes.json() ).id;
	} );

	test.afterAll( async () => {
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( categoryId ) {
			await api.delete(
				`/wp-json/wp/v2/categories/${ categoryId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		if ( otherCategoryId ) {
			await api.delete(
				`/wp-json/wp/v2/categories/${ otherCategoryId }?force=true`,
				{ headers: adminHeaders }
			);
		}
	} );

	test( 'standalone external event carries its url, categories, and uid through the feed', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-08-01&end_date=2035-08-31&per_page=500'
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		const event = body.events.find(
			( e ) => e.event_date_id === eventDateId
		);

		expect( event ).toBeTruthy();
		expect( event.uid.startsWith( 'standalone_' ) ).toBe( true );
		expect( event.url ).toBe( 'https://example.com/standalone-test' );
		expect( event.categories.map( ( c ) => c.id ) ).toContain( categoryId );

		const edRes = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders }
		);
		expect( edRes.ok() ).toBeTruthy();
		const eventDate = await edRes.json();
		expect( event.url ).toBe( eventDate.display_url );
	} );

	// This event was created without an explicit attendance_mode, but
	// EventDatesController::create_item() defaults that to 'in_person' on
	// every new standalone event — it is never left NULL for anything
	// created through the API. The online-marker fallback in
	// PublicEventsController::format_location() is gated on the raw
	// attendance_mode column being NULL specifically so it doesn't override
	// that explicit default; it only applies to pre-3.28.0 rows that
	// predate the attendance_mode column and were never re-saved since (see
	// migrate_to_3_28_0() — no backfill), which the REST create/update
	// endpoints can't produce (update_item() only ever sets attendance_mode,
	// never clears it back to NULL). That legacy-only path is verified via
	// a one-off WP-CLI eval-file check instead (TESTING.md's "Manual
	// Integration Checks" recipe) rather than here.
	test( 'external-link event with the default attendance mode is not mislabeled online', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-08-01&end_date=2035-08-31&per_page=500'
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		const event = body.events.find(
			( e ) => e.event_date_id === eventDateId
		);

		expect( event ).toBeTruthy();
		expect( event ).not.toHaveProperty( 'location' );
	} );

	test( 'categories filter narrows the feed to matching standalone events', async () => {
		const category = await (
			await api.get( `/wp-json/wp/v2/categories/${ categoryId }`, {
				headers: adminHeaders,
			} )
		).json();

		const matchingRes = await api.get(
			`/wp-json/fair-events/v1/events?start_date=2035-08-01&end_date=2035-08-31&categories=${ category.slug }&per_page=500`
		);
		expect( matchingRes.ok() ).toBeTruthy();
		const matchingBody = await matchingRes.json();
		expect(
			matchingBody.events.some( ( e ) => e.event_date_id === eventDateId )
		).toBe( true );

		const otherCategory = await (
			await api.get( `/wp-json/wp/v2/categories/${ otherCategoryId }`, {
				headers: adminHeaders,
			} )
		).json();

		const nonMatchingRes = await api.get(
			`/wp-json/fair-events/v1/events?start_date=2035-08-01&end_date=2035-08-31&categories=${ otherCategory.slug }&per_page=500`
		);
		expect( nonMatchingRes.ok() ).toBeTruthy();
		const nonMatchingBody = await nonMatchingRes.json();
		expect(
			nonMatchingBody.events.some(
				( e ) => e.event_date_id === eventDateId
			)
		).toBe( false );
	} );
} );

test.describe( 'PublicEventsController — location field', () => {
	let api;
	let addressEventDateId;
	let noLocationEventDateId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const addressRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Public feed address test ${ Date.now() }`,
					start_datetime: '2035-08-10 10:00:00',
					end_datetime: '2035-08-10 12:00:00',
					link_type: 'none',
				},
			}
		);
		expect( addressRes.ok() ).toBeTruthy();
		addressEventDateId = ( await addressRes.json() ).id;

		// The create endpoint doesn't wire `address` through — a PUT is
		// needed, same quirk as `event_id` (see the recurring-occurrences
		// test above).
		const addressUpdateRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ addressEventDateId }`,
			{
				headers: adminHeaders,
				data: { address: 'Calle X 1, Madrid' },
			}
		);
		expect( addressUpdateRes.ok() ).toBeTruthy();

		const noLocationRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Public feed no-location test ${ Date.now() }`,
					start_datetime: '2035-08-11 10:00:00',
					end_datetime: '2035-08-11 12:00:00',
					link_type: 'none',
				},
			}
		);
		expect( noLocationRes.ok() ).toBeTruthy();
		noLocationEventDateId = ( await noLocationRes.json() ).id;
	} );

	test.afterAll( async () => {
		if ( addressEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ addressEventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( noLocationEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ noLocationEventDateId }`,
				{ headers: adminHeaders }
			);
		}
	} );

	test( 'free-text address resolves to a location object', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-08-10&end_date=2035-08-10&per_page=500'
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		const event = body.events.find(
			( e ) => e.event_date_id === addressEventDateId
		);
		expect( event ).toBeTruthy();
		expect( event.location ).toEqual( {
			mode: 'in_person',
			address: 'Calle X 1, Madrid',
		} );
	} );

	test( 'event with no location omits the field entirely', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2035-08-11&end_date=2035-08-11&per_page=500'
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		const event = body.events.find(
			( e ) => e.event_date_id === noLocationEventDateId
		);
		expect( event ).toBeTruthy();
		expect( event ).not.toHaveProperty( 'location' );
	} );
} );

// The admin calendar's category filter (#1850) relies on the `categories`
// parameter matching exactly — every representation of an event, no
// descendant categories — so the filtered calendar agrees with the feed.
test.describe( 'PublicEventsController — category filter matching', () => {
	const RANGE = 'start_date=2035-09-01&end_date=2035-09-30&per_page=500';
	let api;
	const categories = {};
	const eventDateIds = {};
	const postIds = [];
	let seriesIds = [];

	async function createCategory( key, extra = {} ) {
		const res = await api.post( '/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: {
				name: `Calendar filter ${ key } ${ Date.now() }`,
				...extra,
			},
		} );
		expect( res.ok() ).toBeTruthy();
		categories[ key ] = await res.json();
	}

	async function createStandalone( key, day, categoryIds ) {
		const res = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Calendar filter ${ key } ${ Date.now() }`,
				start_datetime: `2035-09-${ day } 10:00:00`,
				end_datetime: `2035-09-${ day } 12:00:00`,
				link_type: 'none',
				categories: categoryIds,
			},
		} );
		expect( res.ok() ).toBeTruthy();
		eventDateIds[ key ] = ( await res.json() ).id;
	}

	async function createPostLinked( key, day, { postCategories, rrule } ) {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Calendar filter ${ key } ${ Date.now() }`,
				status: 'publish',
				categories: postCategories,
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		postIds.push( postId );

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Calendar filter ${ key } ${ Date.now() }`,
				link_type: 'post',
				start_datetime: `2035-09-${ day } 18:00:00`,
				end_datetime: `2035-09-${ day } 20:00:00`,
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		const eventDateId = ( await edRes.json() ).id;

		// link_type must be repeated: the update endpoint defaults it to none.
		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{
				headers: adminHeaders,
				data: {
					event_id: postId,
					link_type: 'post',
					...( rrule ? { rrule } : {} ),
				},
			}
		);
		expect( linkRes.ok() ).toBeTruthy();
		eventDateIds[ key ] = eventDateId;
		return linkRes.json();
	}

	async function feedIds( categoryKey ) {
		const filter = categoryKey
			? `&categories=${ categories[ categoryKey ].slug }`
			: '';
		const res = await api.get(
			`/wp-json/fair-events/v1/events?${ RANGE }${ filter }`
		);
		expect( res.ok() ).toBeTruthy();
		return ( await res.json() ).events.map( ( e ) => e.event_date_id );
	}

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		await createCategory( 'music' );
		await createCategory( 'sports' );
		await createCategory( 'jazz', { parent: categories.music.id } );
		await createCategory( 'empty' );

		await createStandalone( 'multi', '02', [
			categories.music.id,
			categories.sports.id,
		] );
		await createStandalone( 'sportsOnly', '03', [ categories.sports.id ] );
		await createStandalone( 'jazzOnly', '04', [ categories.jazz.id ] );
		await createStandalone( 'uncategorized', '05', [] );

		// Post-linked series: generated occurrences inherit the master's
		// categories, which come from the linked post's terms.
		const series = await createPostLinked( 'series', '07', {
			postCategories: [ categories.music.id ],
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		expect( series.generated_occurrences.length ).toBe( 2 );
		seriesIds = [
			eventDateIds.series,
			...series.generated_occurrences.map( ( o ) => o.id ),
		];

		await createPostLinked( 'sportsPost', '08', {
			postCategories: [ categories.sports.id ],
		} );
	} );

	test.afterAll( async () => {
		for ( const key of [
			'multi',
			'sportsOnly',
			'jazzOnly',
			'uncategorized',
		] ) {
			if ( eventDateIds[ key ] ) {
				await api.delete(
					`/wp-json/fair-events/v1/event-dates/${ eventDateIds[ key ] }`,
					{ headers: adminHeaders }
				);
			}
		}
		for ( const postId of postIds ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		for ( const key of [ 'jazz', 'music', 'sports', 'empty' ] ) {
			if ( categories[ key ] ) {
				await api.delete(
					`/wp-json/wp/v2/categories/${ categories[ key ].id }?force=true`,
					{ headers: adminHeaders }
				);
			}
		}
	} );

	test( 'a category matches multi-category events and every series occurrence', async () => {
		const ids = await feedIds( 'music' );

		expect( ids ).toContain( eventDateIds.multi );
		for ( const id of seriesIds ) {
			expect( ids ).toContain( id );
		}
		expect( ids ).not.toContain( eventDateIds.sportsOnly );
		expect( ids ).not.toContain( eventDateIds.sportsPost );
		expect( ids ).not.toContain( eventDateIds.uncategorized );
	} );

	test( 'standalone and post-linked events match the same category', async () => {
		const ids = await feedIds( 'sports' );

		expect( ids ).toContain( eventDateIds.multi );
		expect( ids ).toContain( eventDateIds.sportsOnly );
		expect( ids ).toContain( eventDateIds.sportsPost );
		for ( const id of seriesIds ) {
			expect( ids ).not.toContain( id );
		}
	} );

	test( 'a parent category does not include its descendants', async () => {
		expect( await feedIds( 'music' ) ).not.toContain(
			eventDateIds.jazzOnly
		);
		expect( await feedIds( 'jazz' ) ).toEqual( [ eventDateIds.jazzOnly ] );
	} );

	test( 'a category without events returns an empty list', async () => {
		expect( await feedIds( 'empty' ) ).toEqual( [] );
	} );

	test( 'no filter returns every event, including uncategorized ones', async () => {
		const ids = await feedIds( null );

		for ( const id of [
			eventDateIds.multi,
			eventDateIds.sportsOnly,
			eventDateIds.jazzOnly,
			eventDateIds.uncategorized,
			eventDateIds.sportsPost,
			...seriesIds,
		] ) {
			expect( ids ).toContain( id );
		}
	} );
} );
