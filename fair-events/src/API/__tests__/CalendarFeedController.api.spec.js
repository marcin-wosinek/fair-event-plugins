/**
 * Playwright API tests for CalendarFeedController's public ICS calendar feed
 * (#1059).
 *
 * The feed reuses EventFeedProvider — the same pipeline PublicEventsController
 * consumes — and serializes occurrences as iCalendar via sabre/vobject.
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

test.describe( 'CalendarFeedController — ICS calendar feed', () => {
	let api;
	let eventPostId;
	let timedEventDateId;
	let standaloneEventDateId;
	let allDayEventDateId;
	let categoryId;
	let otherCategoryId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Calendar feed test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const timedRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Calendar feed timed test ${ Date.now() }`,
					link_type: 'post',
					start_datetime: '2035-09-01 10:00:00',
					end_datetime: '2035-09-01 12:00:00',
				},
			}
		);
		expect( timedRes.ok() ).toBeTruthy();
		timedEventDateId = ( await timedRes.json() ).id;

		// The create endpoint doesn't wire event_id through — a PUT is
		// needed to actually link the post (see PublicEventsController's
		// recurring-occurrences test for the same quirk).
		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ timedEventDateId }`,
			{
				headers: adminHeaders,
				data: { event_id: eventPostId },
			}
		);
		expect( linkRes.ok() ).toBeTruthy();

		const categoryRes = await api.post( '/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Calendar feed test ${ Date.now() }` },
		} );
		expect( categoryRes.ok() ).toBeTruthy();
		categoryId = ( await categoryRes.json() ).id;

		const otherCategoryRes = await api.post( '/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Calendar feed unused ${ Date.now() }` },
		} );
		expect( otherCategoryRes.ok() ).toBeTruthy();
		otherCategoryId = ( await otherCategoryRes.json() ).id;

		const standaloneRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Calendar feed standalone test ${ Date.now() }`,
					start_datetime: '2035-09-02 10:00:00',
					end_datetime: '2035-09-02 12:00:00',
					link_type: 'external',
					external_url: 'https://example.com/calendar-feed-test',
					categories: [ categoryId ],
				},
			}
		);
		expect( standaloneRes.ok() ).toBeTruthy();
		standaloneEventDateId = ( await standaloneRes.json() ).id;

		const allDayRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Calendar feed all-day test ${ Date.now() }`,
					start_datetime: '2035-09-03 00:00:00',
					end_datetime: '2035-09-03 00:00:00',
					all_day: true,
					link_type: 'external',
					external_url: 'https://example.com/calendar-feed-all-day',
				},
			}
		);
		expect( allDayRes.ok() ).toBeTruthy();
		allDayEventDateId = ( await allDayRes.json() ).id;
	} );

	test.afterAll( async () => {
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
		}
		if ( standaloneEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ standaloneEventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( allDayEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ allDayEventDateId }`,
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

	test( 'serves a valid ICS feed with the right headers', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/calendar.ics?start_date=2035-09-01&end_date=2035-09-30'
		);
		expect( res.ok() ).toBeTruthy();
		expect( res.headers()[ 'content-type' ] ).toContain( 'text/calendar' );
		expect( res.headers()[ 'content-disposition' ] ).toContain(
			'calendar.ics'
		);

		const body = await res.text();
		expect( body ).toContain( 'BEGIN:VCALENDAR' );
		expect( body ).toContain( 'END:VCALENDAR' );
	} );

	test( 'includes a VEVENT per seeded occurrence with correct UID prefixes and URLs', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/calendar.ics?start_date=2035-09-01&end_date=2035-09-30'
		);
		expect( res.ok() ).toBeTruthy();
		// Unfold RFC 5545 line folding (CRLF + leading space) before
		// substring assertions, since sabre wraps long lines (e.g. URLs).
		const body = ( await res.text() ).replace( /\r\n /g, '' );

		const timedEdRes = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ timedEventDateId }`,
			{ headers: adminHeaders }
		);
		const timedEventDate = await timedEdRes.json();

		expect( body ).toContain(
			`UID:fair_event_${ eventPostId }_${ timedEventDateId }@`
		);
		expect( body ).toContain(
			`URL;VALUE=URI:${ timedEventDate.display_url }`
		);

		// Timed event: local site timezone. A named IANA zone emits
		// DTSTART;TZID=<zone>:<local time> plus a VTIMEZONE block; a
		// fixed-offset zone (e.g. the default UTC test env) keeps the
		// UTC `Z` form, since iCal has no inline-offset form.
		const settingsRes = await api.get( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
		} );
		const { timezone } = await settingsRes.json();
		const isNamedZone = /^[A-Za-z]/.test( timezone );

		if ( isNamedZone ) {
			expect( body ).toMatch( /DTSTART;TZID=[^:]+:\d{8}T\d{6}/ );
			expect( body ).toContain( 'BEGIN:VTIMEZONE' );
			expect( body ).toContain( `TZID:${ timezone }` );
		} else {
			expect( body ).toMatch( /DTSTART:\d{8}T\d{6}Z/ );
		}

		expect( body ).toContain(
			`UID:standalone_${ standaloneEventDateId }@`
		);
		expect( body ).toContain(
			'URL;VALUE=URI:https://example.com/calendar-feed-test'
		);

		// All-day event: DATE value (basic YYYYMMDD, no dashes), exclusive end (+1 day).
		expect( body ).toContain( `UID:standalone_${ allDayEventDateId }@` );
		expect( body ).toMatch( /DTSTART;VALUE=DATE:20350903/ );
		expect( body ).toMatch( /DTEND;VALUE=DATE:20350904/ );
	} );

	test( 'categories filter narrows the feed', async () => {
		const category = await (
			await api.get( `/wp-json/wp/v2/categories/${ categoryId }`, {
				headers: adminHeaders,
			} )
		).json();

		const matchingRes = await api.get(
			`/wp-json/fair-events/v1/calendar.ics?start_date=2035-09-01&end_date=2035-09-30&categories=${ category.slug }`
		);
		expect( matchingRes.ok() ).toBeTruthy();
		const matchingBody = await matchingRes.text();
		expect( matchingBody ).toContain(
			`UID:standalone_${ standaloneEventDateId }@`
		);

		const otherCategory = await (
			await api.get( `/wp-json/wp/v2/categories/${ otherCategoryId }`, {
				headers: adminHeaders,
			} )
		).json();

		const nonMatchingRes = await api.get(
			`/wp-json/fair-events/v1/calendar.ics?start_date=2035-09-01&end_date=2035-09-30&categories=${ otherCategory.slug }`
		);
		expect( nonMatchingRes.ok() ).toBeTruthy();
		const nonMatchingBody = await nonMatchingRes.text();
		expect( nonMatchingBody ).not.toContain(
			`UID:standalone_${ standaloneEventDateId }@`
		);
	} );
} );

test.describe( 'CalendarFeedController — LOCATION line', () => {
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
					title: `Calendar feed address test ${ Date.now() }`,
					start_datetime: '2035-09-10 10:00:00',
					end_datetime: '2035-09-10 12:00:00',
					link_type: 'none',
				},
			}
		);
		expect( addressRes.ok() ).toBeTruthy();
		addressEventDateId = ( await addressRes.json() ).id;

		// The create endpoint doesn't wire `address` through — a PUT is
		// needed, same quirk as `event_id` (see the timed-event setup above).
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
					title: `Calendar feed no-location test ${ Date.now() }`,
					start_datetime: '2035-09-11 10:00:00',
					end_datetime: '2035-09-11 12:00:00',
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

	test( 'emits a LOCATION line for an address event, none for a location-less one', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/calendar.ics?start_date=2035-09-10&end_date=2035-09-11'
		);
		expect( res.ok() ).toBeTruthy();
		const body = ( await res.text() ).replace( /\r\n /g, '' );

		expect( body ).toMatch(
			new RegExp(
				`UID:standalone_${ addressEventDateId }@[^]*?LOCATION:Calle X 1\\\\, Madrid`
			)
		);

		const noLocationBlock = body
			.split( 'BEGIN:VEVENT' )
			.find( ( block ) =>
				block.includes( `standalone_${ noLocationEventDateId }@` )
			);
		expect( noLocationBlock ).toBeTruthy();
		expect( noLocationBlock ).not.toContain( 'LOCATION:' );
	} );
} );

test.describe( 'CalendarFeedController — VTIMEZONE block on named zones', () => {
	let api;
	let originalTimezone;
	let namedZoneEventDateId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const settingsRes = await api.get( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
		} );
		originalTimezone = ( await settingsRes.json() ).timezone;

		const tzRes = await api.post( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
			data: { timezone: 'Europe/Madrid' },
		} );
		expect( tzRes.ok() ).toBeTruthy();

		// Range spans the Europe/Madrid spring-forward DST transition.
		const eventDateRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Calendar feed VTIMEZONE test ${ Date.now() }`,
					start_datetime: '2035-03-15 10:00:00',
					end_datetime: '2035-03-15 12:00:00',
					link_type: 'external',
					external_url: 'https://example.com/calendar-feed-vtimezone',
				},
			}
		);
		expect( eventDateRes.ok() ).toBeTruthy();
		namedZoneEventDateId = ( await eventDateRes.json() ).id;
	} );

	test.afterAll( async () => {
		if ( namedZoneEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ namedZoneEventDateId }`,
				{ headers: adminHeaders }
			);
		}
		await api.post( '/wp-json/wp/v2/settings', {
			headers: adminHeaders,
			data: { timezone: originalTimezone },
		} );
	} );

	test( 'emits a real STANDARD/DAYLIGHT sub-component, not a flattened property', async () => {
		const res = await api.get(
			'/wp-json/fair-events/v1/calendar.ics?start_date=2035-03-01&end_date=2035-04-30'
		);
		expect( res.ok() ).toBeTruthy();
		// Unfold RFC 5545 line folding before substring/regex assertions.
		const body = ( await res.text() ).replace( /\r\n /g, '' );

		expect( body ).toContain( 'BEGIN:VTIMEZONE' );
		expect( body ).toContain( 'TZID:Europe/Madrid' );

		expect( body ).toMatch(
			/BEGIN:(STANDARD|DAYLIGHT)[\s\S]*?END:(STANDARD|DAYLIGHT)/
		);
		expect( body ).toMatch( /TZOFFSETFROM:[+-]\d{4}/ );
		expect( body ).toMatch( /TZOFFSETTO:[+-]\d{4}/ );

		// The bug flattened STANDARD/DAYLIGHT into a property with
		// parameters instead of a real sub-component.
		expect( body ).not.toMatch( /^(DAYLIGHT|STANDARD);DTSTART=/m );
	} );
} );

/**
 * Parse the VEVENTs of an ICS body into { uid, url, description } objects,
 * unfolding RFC 5545 line folding and unescaping TEXT values.
 *
 * @param {string} ics Raw ICS body.
 * @return {Object[]} Parsed events.
 */
function parseVevents( ics ) {
	const unfolded = ics.replace( /\r\n[ \t]/g, '' );
	const unescape = ( value ) =>
		value.replace( /\\([\;,nN])/g, ( _, ch ) =>
			'n' === ch || 'N' === ch ? '\n' : ch
		);
	const property = ( block, name ) => {
		const match = block.match(
			new RegExp( `^${ name }(?:;[^:\\r\\n]*)?:(.*)$`, 'm' )
		);
		return match ? match[ 1 ].replace( /\r$/, '' ) : null;
	};

	return unfolded
		.split( 'BEGIN:VEVENT' )
		.slice( 1 )
		.map( ( block ) => {
			const description = property( block, 'DESCRIPTION' );
			return {
				uid: property( block, 'UID' ),
				url: property( block, 'URL' ),
				description:
					null === description ? null : unescape( description ),
			};
		} );
}

test.describe( 'CalendarFeedController — event links in DESCRIPTION (#1691)', () => {
	const RANGE = 'start_date=2035-10-01&end_date=2035-10-31';
	const EXCERPT = 'Bring comfortable shoes, please.';

	let api;
	let postId;
	let postSeriesIds = [];
	let externalId;
	let noUrlId;
	let noUrlSeriesIds = [];
	let noUrlTitle;
	let seriesTitle;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Calendar feed link post ${ Date.now() }`,
				excerpt: EXCERPT,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		postId = ( await postRes.json() ).id;

		const postMasterRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: 'Calendar feed link post series',
					link_type: 'post',
					start_datetime: '2035-10-01 10:00:00',
					end_datetime: '2035-10-01 12:00:00',
				},
			}
		);
		expect( postMasterRes.ok() ).toBeTruthy();
		const postMasterId = ( await postMasterRes.json() ).id;

		const postLinkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ postMasterId }`,
			{
				headers: adminHeaders,
				data: { event_id: postId, rrule: 'FREQ=WEEKLY;COUNT=2' },
			}
		);
		expect( postLinkRes.ok() ).toBeTruthy();
		postSeriesIds = [
			postMasterId,
			...( await postLinkRes.json() ).generated_occurrences.map(
				( o ) => o.id
			),
		];
		expect( postSeriesIds.length ).toBe( 2 );

		const externalRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Calendar feed link external ${ Date.now() }`,
					start_datetime: '2035-10-02 10:00:00',
					end_datetime: '2035-10-02 12:00:00',
					link_type: 'external',
					external_url: 'https://example.com/calendar-feed-link',
				},
			}
		);
		expect( externalRes.ok() ).toBeTruthy();
		externalId = ( await externalRes.json() ).id;

		noUrlTitle = `Calendar feed link none ${ Date.now() }`;
		const noUrlRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: noUrlTitle,
					start_datetime: '2035-10-03 10:00:00',
					end_datetime: '2035-10-03 12:00:00',
					link_type: 'none',
				},
			}
		);
		expect( noUrlRes.ok() ).toBeTruthy();
		noUrlId = ( await noUrlRes.json() ).id;

		seriesTitle = `Calendar feed link none series ${ Date.now() }`;
		const seriesRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: seriesTitle,
					start_datetime: '2035-10-04 18:00:00',
					end_datetime: '2035-10-04 19:00:00',
					link_type: 'none',
				},
			}
		);
		expect( seriesRes.ok() ).toBeTruthy();
		const seriesMasterId = ( await seriesRes.json() ).id;

		const rruleRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ seriesMasterId }`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=3' },
			}
		);
		expect( rruleRes.ok() ).toBeTruthy();
		noUrlSeriesIds = [
			seriesMasterId,
			...( await rruleRes.json() ).generated_occurrences.map(
				( o ) => o.id
			),
		];
		expect( noUrlSeriesIds.length ).toBe( 3 );
	} );

	test.afterAll( async () => {
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		for ( const id of [ postSeriesIds[ 0 ], externalId, noUrlId ] ) {
			if ( id ) {
				await api.delete(
					`/wp-json/fair-events/v1/event-dates/${ id }`,
					{
						headers: adminHeaders,
					}
				);
			}
		}
		if ( noUrlSeriesIds[ 0 ] ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ noUrlSeriesIds[ 0 ] }`,
				{ headers: adminHeaders }
			);
		}
	} );

	/**
	 * Fetch the feed and index its VEVENTs by event-date ID.
	 *
	 * @return {Promise<Map<number, Object>>} Event-date ID => parsed VEVENT.
	 */
	async function feedByEventDateId() {
		const res = await api.get(
			`/wp-json/fair-events/v1/calendar.ics?${ RANGE }`
		);
		expect( res.ok() ).toBeTruthy();

		const byId = new Map();
		for ( const vevent of parseVevents( await res.text() ) ) {
			const match = vevent.uid?.match( /_(\d+)@/ );
			if ( match ) {
				byId.set( Number( match[ 1 ] ), vevent );
			}
		}
		return byId;
	}

	/**
	 * Resolve a feed URL against the test site, keeping path and query.
	 *
	 * @param {string} url Absolute URL from the feed.
	 * @return {string} Path + query.
	 */
	function localPath( url ) {
		const parsed = new URL( url );
		return parsed.pathname + parsed.search;
	}

	test( 'every entry has its link in URL and as the final DESCRIPTION line', async () => {
		const byId = await feedByEventDateId();
		const ids = [
			...postSeriesIds,
			externalId,
			noUrlId,
			...noUrlSeriesIds,
		];

		for ( const id of ids ) {
			const vevent = byId.get( id );
			expect( vevent, `VEVENT for event date ${ id }` ).toBeTruthy();
			expect( vevent.url ).toBeTruthy();

			const lines = vevent.description.split( '\n' );
			expect( lines[ lines.length - 1 ] ).toBe( vevent.url );
			expect(
				lines.filter( ( line ) => line === vevent.url ).length
			).toBe( 1 );
		}
	} );

	test( 'local post events keep their text and link to the right occurrence', async () => {
		const byId = await feedByEventDateId();

		for ( const id of postSeriesIds ) {
			const edRes = await api.get(
				`/wp-json/fair-events/v1/event-dates/${ id }`,
				{ headers: adminHeaders }
			);
			const eventDate = await edRes.json();
			const vevent = byId.get( id );

			expect( vevent.url ).toBe( eventDate.display_url );
			expect( vevent.description ).toBe(
				`${ EXCERPT }\n\n${ eventDate.display_url }`
			);
		}

		// The generated occurrence points at its own date.
		expect( byId.get( postSeriesIds[ 1 ] ).url ).toContain(
			'event_date=2035-10-08'
		);
	} );

	test( 'external events link to their original page', async () => {
		const vevent = ( await feedByEventDateId() ).get( externalId );

		expect( vevent.url ).toBe( 'https://example.com/calendar-feed-link' );
		expect( vevent.description ).toBe(
			'https://example.com/calendar-feed-link'
		);
	} );

	test( 'events without a URL link to a view of that event date', async () => {
		const byId = await feedByEventDateId();

		const single = byId.get( noUrlId );
		expect( single.url ).toMatch(
			new RegExp( `[?&]fair_event_date=${ noUrlId }$` )
		);

		const res = await api.get( localPath( single.url ) );
		expect( res.status() ).toBe( 200 );
		const html = await res.text();
		expect( html ).toContain( noUrlTitle );

		// Each occurrence of a series links to its own row.
		const seriesUrls = noUrlSeriesIds.map( ( id ) => byId.get( id ).url );
		noUrlSeriesIds.forEach( ( id, index ) => {
			expect( seriesUrls[ index ] ).toMatch(
				new RegExp( `[?&]fair_event_date=${ id }$` )
			);
		} );
		expect( new Set( seriesUrls ).size ).toBe( noUrlSeriesIds.length );

		const thirdRes = await api.get( localPath( seriesUrls[ 2 ] ) );
		expect( thirdRes.status() ).toBe( 200 );
		const thirdHtml = await thirdRes.text();
		expect( thirdHtml ).toContain( seriesTitle );
		expect( thirdHtml ).toMatch( /18 October|October 18/ );
	} );

	test( 'repeated feed requests do not duplicate the link', async () => {
		const first = await feedByEventDateId();
		const second = await feedByEventDateId();

		for ( const [ id, vevent ] of first ) {
			expect( second.get( id ).description ).toBe( vevent.description );
		}
	} );

	test( 'the event-date view 404s for missing, malformed, cancelled, and post-linked rows', async () => {
		for ( const value of [ '999999999', 'abc' ] ) {
			const res = await api.get( `/?fair_event_date=${ value }` );
			expect( res.status(), `fair_event_date=${ value }` ).toBe( 404 );
		}

		const postRes = await api.get(
			`/?fair_event_date=${ postSeriesIds[ 0 ] }`
		);
		expect( postRes.status() ).toBe( 404 );

		const cancelRes = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ noUrlSeriesIds[ 0 ] }/toggle-exdate`,
			{ headers: adminHeaders, data: { date: '2035-10-11' } }
		);
		expect( cancelRes.ok() ).toBeTruthy();

		const cancelledRes = await api.get(
			`/?fair_event_date=${ noUrlSeriesIds[ 1 ] }`
		);
		expect( cancelledRes.status() ).toBe( 404 );

		// Restore, so test order doesn't matter.
		await api.post(
			`/wp-json/fair-events/v1/event-dates/${ noUrlSeriesIds[ 0 ] }/toggle-exdate`,
			{ headers: adminHeaders, data: { date: '2035-10-11' } }
		);
	} );

	test( 'the event-date view redirects once the event has a link', async () => {
		const res = await api.get( `/?fair_event_date=${ externalId }`, {
			maxRedirects: 0,
		} );
		expect( res.status() ).toBe( 302 );
		expect( res.headers().location ).toBe(
			'https://example.com/calendar-feed-link'
		);
	} );
} );
