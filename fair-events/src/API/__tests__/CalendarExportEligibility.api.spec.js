/**
 * Playwright API tests for calendar export eligibility (#1819, stage 3).
 *
 * Only explicitly all-day events and events with both a start and an end
 * time are exported to calendars. An event missing a time stays in the JSON
 * feeds (and says it is not exportable) but is left out of the ICS feed,
 * and the calendar button gives it no calendar entry. Eligibility is
 * decided per occurrence after overrides: a series mixing both is exported
 * one occurrence at a time, never with a rule that would bring back the
 * left-out dates.
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

const BUTTON_CONTENT = [
	'<!-- wp:buttons -->',
	'<div class="wp-block-buttons"><!-- wp:button {"isCalendarButton":true} -->',
	'<div class="wp-block-button"><a class="wp-block-button__link wp-element-button">Add to calendar</a></div>',
	'<!-- /wp:button --></div>',
	'<!-- /wp:buttons -->',
].join( '\n' );

/**
 * Attributes of the calendar button's link in a rendered page.
 *
 * @param {string} html Page HTML.
 * @return {Object<string, string>} Attribute values by name.
 */
const calendarButtonAttributes = ( html ) => {
	const tag = html.match( /<a [^>]*data-calendar-button="true"[^>]*>/ );
	expect( tag ).toBeTruthy();

	const attributes = {};
	const repeated = [];
	for ( const [ , name, value ] of tag[ 0 ].matchAll(
		/([a-z-]+)="([^"]*)"/g
	) ) {
		if ( name in attributes ) {
			repeated.push( name );
		} else {
			attributes[ name ] = value.replace( /&amp;/g, '&' );
		}
	}
	// Each attribute is injected once (#1851).
	expect( repeated ).toEqual( [] );
	return attributes;
};

/**
 * VEVENT UIDs in an ICS body.
 *
 * @param {string} body ICS body.
 * @return {string[]} UIDs.
 */
const uidsOf = ( body ) =>
	[ ...body.replace( /\r\n /g, '' ).matchAll( /^UID:(.+)$/gm ) ].map(
		( match ) => match[ 1 ].trim()
	);

test.describe( 'Calendar export eligibility', () => {
	let api;
	const eventDateIds = [];
	const postIds = [];

	const createEventDate = async ( data ) => {
		const response = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Export eligibility ${ Date.now() }`,
					link_type: 'external',
					external_url: 'https://example.com/export-eligibility',
					...data,
				},
			}
		);
		expect( response.status() ).toBe( 201 );
		const body = await response.json();
		eventDateIds.push( body.id );
		return body;
	};

	const readEventDate = async ( id ) => {
		const response = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ id }`,
			{ headers: adminHeaders }
		);
		expect( response.ok() ).toBeTruthy();
		return response.json();
	};

	const updateEventDate = async ( id, data ) => {
		const response = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ id }`,
			{ headers: adminHeaders, data }
		);
		expect( response.status() ).toBe( 200 );
		return response.json();
	};

	/**
	 * Create a published event post with a calendar button, linked to a
	 * new event date with the given timing.
	 *
	 * @param {Object} timing Event date fields.
	 * @return {Promise<{link: string, eventDate: Object}>} Post link and event date.
	 */
	const createButtonPost = async ( timing ) => {
		const postResponse = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Export button ${ Date.now() }`,
				status: 'publish',
				content: BUTTON_CONTENT,
			},
		} );
		expect( postResponse.ok() ).toBeTruthy();
		const post = await postResponse.json();
		postIds.push( post.id );

		const eventDate = await createEventDate( {
			link_type: 'post',
			external_url: undefined,
			...timing,
		} );
		// The create endpoint doesn't wire event_id through.
		await updateEventDate( eventDate.id, { event_id: post.id } );

		return {
			link: post.link,
			eventDate: await readEventDate( eventDate.id ),
		};
	};

	const buttonOn = async ( url ) => {
		const response = await api.get( url );
		expect( response.ok() ).toBeTruthy();
		return calendarButtonAttributes( await response.text() );
	};

	const icsBody = async ( range ) => {
		const response = await api.get(
			`/wp-json/fair-events/v1/calendar.ics?${ range }`
		);
		expect( response.ok() ).toBeTruthy();
		return response.text();
	};

	const icsUids = async ( range ) => uidsOf( await icsBody( range ) );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterAll( async () => {
		for ( const id of postIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of [ ...new Set( eventDateIds ) ] ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		await api.dispose();
	} );

	test( 'the ICS feed leaves out events missing a time, the JSON feed keeps them', async () => {
		const cases = {
			both: {
				start_date: '2039-04-01',
				start_time: '18:00',
				end_time: '20:00',
			},
			startOnly: { start_date: '2039-04-02', start_time: '18:00' },
			endOnly: { start_date: '2039-04-03', end_time: '20:00' },
			neither: { start_date: '2039-04-04' },
			midnight: {
				start_date: '2039-04-05',
				end_date: '2039-04-06',
				start_time: '00:00',
				end_time: '00:00',
			},
			allDay: {
				start_date: '2039-04-07',
				end_date: '2039-04-09',
				all_day: true,
			},
			multiDayStartOnly: {
				start_date: '2039-04-10',
				end_date: '2039-04-12',
				start_time: '09:00',
			},
		};
		const eligible = {
			both: true,
			startOnly: false,
			endOnly: false,
			neither: false,
			midnight: true,
			allDay: true,
			multiDayStartOnly: false,
		};

		const ids = {};
		for ( const [ name, timing ] of Object.entries( cases ) ) {
			ids[ name ] = ( await createEventDate( timing ) ).id;
		}

		for ( const [ name, id ] of Object.entries( ids ) ) {
			const eventDate = await readEventDate( id );
			expect( eventDate.calendar_export_eligible, name ).toBe(
				eligible[ name ]
			);
		}

		const uids = await icsUids(
			'start_date=2039-04-01&end_date=2039-04-30'
		);
		for ( const [ name, id ] of Object.entries( ids ) ) {
			expect(
				uids.some( ( uid ) => uid.startsWith( `standalone_${ id }@` ) ),
				name
			).toBe( eligible[ name ] );
		}

		const jsonResponse = await api.get(
			'/wp-json/fair-events/v1/events?start_date=2039-04-01&end_date=2039-04-30&per_page=500'
		);
		expect( jsonResponse.ok() ).toBeTruthy();
		const { events } = await jsonResponse.json();

		for ( const [ name, id ] of Object.entries( ids ) ) {
			const event = events.find( ( e ) => e.event_date_id === id );
			expect( event, name ).toBeTruthy();
			expect( event.calendar_export_eligible, name ).toBe(
				eligible[ name ]
			);
		}

		const startOnly = events.find(
			( e ) => e.event_date_id === ids.startOnly
		);
		expect( startOnly ).toMatchObject( {
			start_date: '2039-04-02',
			end_date: '2039-04-02',
			start_time: '18:00:00',
			end_time: null,
			all_day: false,
		} );
		const midnight = events.find(
			( e ) => e.event_date_id === ids.midnight
		);
		expect( midnight ).toMatchObject( {
			start_time: '00:00:00',
			end_time: '00:00:00',
		} );
	} );

	test( 'a series is exported per occurrence, after overrides', async () => {
		// Start-only series: no date is exportable until one gets an end.
		const master = await createEventDate( {
			start_date: '2039-05-02',
			start_time: '18:00',
			rrule: 'FREQ=WEEKLY;COUNT=4',
		} );
		const series = await readEventDate( master.id );
		const children = series.generated_occurrences;
		expect( children ).toHaveLength( 3 );
		expect( series.calendar_export_eligible ).toBe( false );
		expect(
			children.map( ( child ) => child.calendar_export_eligible )
		).toEqual( [ false, false, false ] );

		const override = await updateEventDate( children[ 1 ].id, {
			end_time: '20:00',
		} );
		expect( override.calendar_export_eligible ).toBe( true );

		const range = 'start_date=2039-05-01&end_date=2039-05-31';
		let uids = await icsUids( range );
		const seriesUids = ( ids ) =>
			ids.filter( ( id ) =>
				uids.some( ( uid ) => uid.startsWith( `standalone_${ id }@` ) )
			);
		const allIds = [ master.id, ...children.map( ( child ) => child.id ) ];
		expect( seriesUids( allIds ) ).toEqual( [ children[ 1 ].id ] );

		// Fully timed series with one date's end time cleared.
		await updateEventDate( master.id, { end_time: '20:00' } );
		await updateEventDate( children[ 2 ].id, { end_time: null } );

		uids = await icsUids( range );
		expect( seriesUids( allIds ) ).toEqual( [
			master.id,
			children[ 0 ].id,
			children[ 1 ].id,
		] );
		expect( await icsBody( range ) ).not.toContain( 'RRULE' );
	} );

	test( 'the calendar button exports only exportable dates', async () => {
		const timed = await createButtonPost( {
			start_date: '2039-06-01',
			start_time: '18:00',
			end_time: '20:00',
		} );
		const timedButton = await buttonOn( timed.link );
		expect( timedButton[ 'data-start' ] ).toBe( '2039-06-01 18:00:00' );
		expect( timedButton[ 'data-end' ] ).toBe( '2039-06-01 20:00:00' );
		expect( timedButton[ 'data-calendar-available' ] ).toBeUndefined();

		const startOnly = await createButtonPost( {
			start_date: '2039-06-02',
			start_time: '18:00',
		} );
		const startOnlyButton = await buttonOn( startOnly.link );
		expect( startOnlyButton[ 'data-calendar-available' ] ).toBe( 'false' );
		expect( startOnlyButton[ 'aria-disabled' ] ).toBe( 'true' );
		expect( startOnlyButton[ 'data-start' ] ).toBeUndefined();

		const allDay = await createButtonPost( {
			start_date: '2039-06-03',
			end_date: '2039-06-04',
			all_day: true,
		} );
		const allDayButton = await buttonOn( allDay.link );
		expect( allDayButton[ 'data-all-day' ] ).toBe( 'true' );
		expect( allDayButton[ 'data-start' ] ).toBe( '2039-06-03 00:00:00' );
		expect( allDayButton[ 'data-end' ] ).toBe( '2039-06-04 00:00:00' );
	} );

	test( 'an unavailable calendar button explains why, without a link (#1851)', async () => {
		const postResponse = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Unavailable button ${ Date.now() }`,
				status: 'publish',
				content: BUTTON_CONTENT.replace(
					'<a class="wp-block-button__link wp-element-button">',
					'<a class="wp-block-button__link wp-element-button" href="https://example.com/add">'
				),
			},
		} );
		expect( postResponse.ok() ).toBeTruthy();
		const post = await postResponse.json();
		postIds.push( post.id );
		const eventDate = await createEventDate( {
			link_type: 'post',
			external_url: undefined,
			start_date: '2039-06-05',
			end_time: '20:00',
		} );
		await updateEventDate( eventDate.id, { event_id: post.id } );

		const response = await api.get( post.link );
		expect( response.ok() ).toBeTruthy();
		const html = await response.text();
		const button = calendarButtonAttributes( html );

		expect( button[ 'data-calendar-available' ] ).toBe( 'false' );
		expect( button.href ).toBeUndefined();
		const note = html.match(
			/<p class="fair-events-calendar-unavailable" id="([^"]+)">([^<]+)<\/p>/
		);
		expect( note ).toBeTruthy();
		expect( button[ 'aria-describedby' ] ).toBe( note[ 1 ] );
		expect( note[ 2 ] ).toBe(
			'Both start and end times are required to add this event to a calendar.'
		);
	} );

	test( 'the calendar button keeps the rule only when every date is exportable', async () => {
		const { link, eventDate } = await createButtonPost( {
			start_date: '2039-07-04',
			start_time: '18:00',
			end_time: '20:00',
			rrule: 'FREQ=WEEKLY;COUNT=4',
		} );
		const children = eventDate.generated_occurrences;
		expect( children ).toHaveLength( 3 );

		const series = await buttonOn( link );
		expect( series[ 'data-recurring' ] ).toBe( 'true' );
		expect( series[ 'data-rrule' ] ).toBe( 'FREQ=WEEKLY;COUNT=4' );
		expect( series[ 'data-start' ] ).toBe( '2039-07-04 18:00:00' );

		// Clearing the series' end time mixes it once one date keeps its
		// own times: the overview exports that date alone, linked to it.
		await updateEventDate( eventDate.id, { end_time: null } );
		await updateEventDate( children[ 1 ].id, {
			start_time: '19:00',
			end_time: '21:00',
		} );

		const mixed = await buttonOn( link );
		expect( mixed[ 'data-recurring' ] ).toBe( 'false' );
		expect( mixed[ 'data-rrule' ] ).toBe( '' );
		expect( mixed[ 'data-start' ] ).toBe( '2039-07-18 19:00:00' );
		expect( mixed[ 'data-end' ] ).toBe( '2039-07-18 21:00:00' );
		expect( mixed[ 'data-url' ] ).toContain( 'event_date=2039-07-18' );

		// A selected date exports itself, and only when it is exportable.
		const separator = link.includes( '?' ) ? '&' : '?';
		const ineligible = await buttonOn(
			`${ link }${ separator }event_date=2039-07-11`
		);
		expect( ineligible[ 'data-calendar-available' ] ).toBe( 'false' );

		const eligibleSession = await buttonOn(
			`${ link }${ separator }event_date=2039-07-18`
		);
		expect( eligibleSession[ 'data-recurring' ] ).toBe( 'false' );
		expect( eligibleSession[ 'data-start' ] ).toBe( '2039-07-18 19:00:00' );

		// With no exportable date left, the overview has nothing to export.
		await updateEventDate( children[ 1 ].id, { end_time: null } );
		const none = await buttonOn( link );
		expect( none[ 'data-calendar-available' ] ).toBe( 'false' );
	} );
} );
