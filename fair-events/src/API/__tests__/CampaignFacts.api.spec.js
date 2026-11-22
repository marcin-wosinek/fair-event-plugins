/**
 * Playwright API tests for GET /fair-events/v1/event-dates/{id}/campaign-facts
 * (#2420): the authoritative occurrence and venue facts of a campaign-facts
 * v1 snapshot.
 *
 * Covers access (anonymous, without `edit_posts`, authorized), standalone and
 * generated occurrences (inheritance, draft series, cancelled occurrence,
 * timing override, occurrence-aware page URL), undated, all-day and partly
 * timed records, named and fixed-offset timezones, online and hybrid events
 * with joining links, venue normalization and coordinates, and missing
 * records and broken references staying errors.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';
const USER_PASSWORD = 'Test-password-2420!';

const root = new URL( '../../../../', import.meta.url );

const basicAuth = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );

const adminHeaders = basicAuth( ADMIN_USER, ADMIN_PASSWORD );

/**
 * Run an action of the campaign-facts WP-CLI fixture.
 *
 * @param {string} action Fixture action.
 * @param {Object} data   Action data.
 * @return {Promise<Object>} Fixture result.
 */
async function fixture( action, data = {} ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[
			'wp-env',
			'run',
			'tests-cli',
			'wp',
			'eval-file',
			'wp-content/mu-plugins/scripts/campaign-facts.php',
			action,
			JSON.stringify( data ),
		],
		{ cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
	);
	const match = stdout.match( /E2E_CAMPAIGN_FACTS:(\{.*\})/ );
	if ( ! match ) {
		throw new Error( `Expected fixture output, got:\n${ stdout }` );
	}
	return JSON.parse( match[ 1 ] );
}

test.describe( 'CampaignFactsController — occurrence and venue facts', () => {
	let api;
	const run = Date.now();
	const eventDateIds = [];
	const venueIds = [];
	const pageIds = [];
	const userIds = [];
	let previousTimezone;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		previousTimezone = await fixture( 'timezone', {
			timezone_string: 'Europe/Madrid',
			gmt_offset: 0,
		} );
	} );

	test.afterAll( async () => {
		await fixture( 'timezone', previousTimezone );
		for ( const id of [ ...new Set( eventDateIds ) ].reverse() ) {
			await api.delete( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of venueIds ) {
			await fixture( 'delete-venue', { id } );
		}
		for ( const id of pageIds ) {
			await api.delete( `/wp-json/wp/v2/pages/${ id }?force=true`, {
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

	const facts = ( id, headers = adminHeaders ) =>
		api.get( `/wp-json/fair-events/v1/event-dates/${ id }/campaign-facts`, {
			headers,
		} );

	const readFacts = async ( id ) => {
		const response = await facts( id );
		expect( response.status(), await response.text() ).toBe( 200 );
		return response.json();
	};

	const createEvent = async ( label, data = {} ) => {
		const response = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Campaign ${ label } ${ run }`,
					start_date: '2037-05-10',
					end_date: '2037-05-10',
					start_time: '10:00:00',
					end_time: '12:00:00',
					...data,
				},
			}
		);
		expect( response.status(), await response.text() ).toBe( 201 );
		const body = await response.json();
		eventDateIds.push( body.id );
		return body;
	};

	const readEventDate = async ( id ) =>
		(
			await api.get( `/wp-json/fair-events/v1/event-dates/${ id }`, {
				headers: adminHeaders,
			} )
		).json();

	const createPage = async ( label ) => {
		const response = await api.post( '/wp-json/wp/v2/pages', {
			headers: adminHeaders,
			data: {
				title: `Campaign page ${ label } ${ run }`,
				status: 'publish',
			},
		} );
		expect( response.ok(), await response.text() ).toBeTruthy();
		const page = await response.json();
		pageIds.push( page.id );
		return page;
	};

	const createVenue = async ( columns ) => {
		const { id } = await fixture( 'venue', { columns } );
		venueIds.push( id );
		return id;
	};

	const createUser = async ( role ) => {
		const login = `campaign-${ role }-${ run }`;
		const response = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password: USER_PASSWORD,
				roles: [ role ],
			},
		} );
		expect( response.ok(), await response.text() ).toBeTruthy();
		userIds.push( ( await response.json() ).id );
		return basicAuth( login, USER_PASSWORD );
	};

	test( 'requires a logged-in user who can edit posts', async () => {
		const event = await createEvent( 'access' );

		const anonymous = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ event.id }/campaign-facts`
		);
		expect( anonymous.status() ).toBe( 401 );

		const subscriber = await facts(
			event.id,
			await createUser( 'subscriber' )
		);
		expect( subscriber.status() ).toBe( 403 );

		expect( ( await facts( event.id ) ).status() ).toBe( 200 );
		expect( ( await facts( 2147480000 ) ).status() ).toBe( 404 );
	} );

	test( 'reads a standalone event with a legacy null attendance mode', async () => {
		const event = await createEvent( 'standalone & co', {
			link_type: 'external',
			external_url: 'https://partner.example.com/event',
			address: 'Free text street 1',
		} );
		await fixture( 'event-date', {
			id: event.id,
			columns: { attendance_mode: null },
		} );

		const body = await readFacts( event.id );

		expect( body ).toEqual( {
			eventDateId: event.id,
			event: {
				title: `Campaign standalone & co ${ run }`,
				contentLanguage: null,
				status: 'active',
				publicationStatus: 'publish',
				attendanceMode: 'in_person',
				timing: {
					timezone: 'Europe/Madrid',
					allDay: false,
					startDate: '2037-05-10',
					endDate: '2037-05-10',
					startTime: '10:00:00',
					endTime: '12:00:00',
				},
				venueId: null,
				urls: { event: null, booking: null },
			},
			venues: [],
		} );
	} );

	test( 'reads a generated occurrence from its draft series', async () => {
		const venueId = await createVenue( { name: 'Series hall' } );
		const master = await createEvent( 'series', {
			start_date: '2037-06-01',
			end_date: '2037-06-01',
			start_time: '18:00',
			end_time: '20:00',
			rrule: 'FREQ=WEEKLY;COUNT=3',
			attendance_mode: 'hybrid',
			joining_link: 'https://example.com/meet/private-series',
		} );
		await fixture( 'event-date', {
			id: master.id,
			columns: { venue_id: venueId },
		} );
		const page = await createPage( 'series' );
		const linked = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ master.id }/link-post`,
			{ headers: adminHeaders, data: { post_id: page.id } }
		);
		expect( linked.ok(), await linked.text() ).toBeTruthy();
		const drafted = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ master.id }/publication-status`,
			{ headers: adminHeaders, data: { publication_status: 'draft' } }
		);
		expect( drafted.ok(), await drafted.text() ).toBeTruthy();

		const children = ( await readEventDate( master.id ) )
			.generated_occurrences;
		expect( children.length ).toBeGreaterThanOrEqual( 2 );
		const child = children[ 1 ];

		// A cancelled occurrence with its own times. Written in the row: a
		// partial PUT would also store the attendance mode argument's
		// default, so the occurrence would no longer inherit it.
		await fixture( 'event-date', {
			id: child.id,
			columns: {
				status: 'cancelled',
				start_time: '17:30:00',
				times_override: 1,
			},
		} );

		const body = await readFacts( child.id );
		const pageLink = (
			await (
				await api.get( `/wp-json/wp/v2/pages/${ page.id }`, {
					headers: adminHeaders,
				} )
			).json()
		).link;

		expect( body.eventDateId ).toBe( child.id );
		// Linking the page makes the series post-linked, so its title is
		// the page's, resolved through the master for the occurrence.
		expect( body.event.title ).toBe( `Campaign page series ${ run }` );
		expect( body.event.status ).toBe( 'cancelled' );
		expect( body.event.publicationStatus ).toBe( 'draft' );
		expect( body.event.attendanceMode ).toBe( 'hybrid' );
		expect( body.event.timing ).toMatchObject( {
			startDate: child.start_date,
			endDate: child.end_date,
			startTime: '17:30:00',
			endTime: '20:00:00',
			allDay: false,
		} );
		expect( body.event.venueId ).toBe( `venue:${ venueId }` );
		expect( body.venues ).toEqual( [
			{
				id: `venue:${ venueId }`,
				sourceId: venueId,
				name: 'Series hall',
				address: null,
				coordinates: null,
				websiteUrl: null,
				instagramHandle: null,
				facebookPageUrl: null,
			},
		] );

		const eventUrl = new URL( body.event.urls.event );
		expect( eventUrl.searchParams.get( 'event_date' ) ).toBe(
			child.start_date
		);
		eventUrl.searchParams.delete( 'event_date' );
		expect( eventUrl.toString() ).toBe( new URL( pageLink ).toString() );
		expect( body.event.urls.booking ).toBeNull();
		expect( JSON.stringify( body ) ).not.toContain( 'private-series' );

		// The master links to the plain page, without a session argument.
		const masterFacts = await readFacts( master.id );
		expect(
			new URL( masterFacts.event.urls.event ).searchParams.has(
				'event_date'
			)
		).toBe( false );
	} );

	test( 'preserves undated, all-day and partly timed records', async () => {
		// Undated rows come from posts created without event details; the
		// REST API requires a start date, so clear it in the row.
		const undated = await createEvent( 'undated' );
		await fixture( 'event-date', {
			id: undated.id,
			columns: {
				start_date: null,
				end_date: null,
				start_time: null,
				end_time: null,
			},
		} );
		const allDay = await createEvent( 'all day', {
			start_date: '2037-07-01',
			end_date: '2037-07-03',
			start_time: null,
			end_time: null,
			all_day: true,
		} );
		const startOnly = await createEvent( 'start only', {
			end_time: null,
		} );
		const endOnly = await createEvent( 'end only', {
			start_time: null,
		} );

		const timingOf = async ( id ) => ( await readFacts( id ) ).event.timing;

		expect( await timingOf( undated.id ) ).toEqual( {
			timezone: 'Europe/Madrid',
			allDay: false,
			startDate: null,
			endDate: null,
			startTime: null,
			endTime: null,
		} );
		expect( await timingOf( allDay.id ) ).toEqual( {
			timezone: 'Europe/Madrid',
			allDay: true,
			startDate: '2037-07-01',
			endDate: '2037-07-03',
			startTime: null,
			endTime: null,
		} );
		expect( await timingOf( startOnly.id ) ).toMatchObject( {
			startTime: '10:00:00',
			endTime: null,
		} );
		expect( await timingOf( endOnly.id ) ).toMatchObject( {
			startTime: null,
			endTime: '12:00:00',
		} );
	} );

	test( 'exposes a fixed-offset site timezone as configured', async () => {
		const event = await createEvent( 'offset' );
		try {
			await fixture( 'timezone', {
				timezone_string: '',
				gmt_offset: 5.5,
			} );
			expect(
				( await readFacts( event.id ) ).event.timing.timezone
			).toBe( '+05:30' );
		} finally {
			await fixture( 'timezone', {
				timezone_string: 'Europe/Madrid',
				gmt_offset: 0,
			} );
		}
	} );

	test( 'keeps joining links out of online events', async () => {
		const event = await createEvent( 'online', {
			attendance_mode: 'online',
			joining_link: 'https://example.com/meet/private-online',
		} );

		const body = await readFacts( event.id );

		expect( body.event.attendanceMode ).toBe( 'online' );
		expect( body.event.urls ).toEqual( { event: null, booking: null } );
		expect( JSON.stringify( body ) ).not.toContain( 'private-online' );
	} );

	test( 'normalizes venue fields and coordinates', async () => {
		const cases = [
			{
				columns: {
					name: 'Full venue',
					address: 'Gran Via 1, Valencia',
					latitude: '39.4878023',
					longitude: '-0.3613204',
					website_url: 'https://venue.example.com',
					instagram_handle: '@fullvenue',
					facebook_page_link: 'https://facebook.com/fullvenue',
				},
				expected: {
					address: 'Gran Via 1, Valencia',
					coordinates: {
						latitude: 39.4878023,
						longitude: -0.3613204,
					},
					websiteUrl: 'https://venue.example.com',
					instagramHandle: 'fullvenue',
					facebookPageUrl: 'https://facebook.com/fullvenue',
				},
			},
			{
				columns: {
					name: 'Blank venue',
					address: '  ',
					latitude: '0',
					longitude: '0',
					website_url: '',
					instagram_handle: '@',
					facebook_page_link: '',
				},
				expected: {
					address: null,
					coordinates: { latitude: 0, longitude: 0 },
					websiteUrl: null,
					instagramHandle: null,
					facebookPageUrl: null,
				},
			},
			{
				columns: { name: 'Partial venue', latitude: '39.48' },
				expected: { coordinates: null },
			},
			{
				columns: {
					name: 'Invalid venue',
					latitude: 'north',
					longitude: '-0.36',
				},
				expected: { coordinates: null },
			},
			{
				columns: {
					name: 'Out of range venue',
					latitude: '91',
					longitude: '0',
				},
				expected: { coordinates: null },
			},
		];

		for ( const { columns, expected } of cases ) {
			const venueId = await createVenue( columns );
			const event = await createEvent( columns.name );
			await fixture( 'event-date', {
				id: event.id,
				columns: { venue_id: venueId },
			} );

			const body = await readFacts( event.id );

			expect( body.event.venueId ).toBe( `venue:${ venueId }` );
			expect( body.venues ).toHaveLength( 1 );
			expect( body.venues[ 0 ] ).toMatchObject( {
				id: `venue:${ venueId }`,
				sourceId: venueId,
				name: columns.name,
				...expected,
			} );
		}
	} );

	test( 'reports missing records and broken references as errors', async () => {
		// A venue association whose venue no longer exists.
		const venueId = await createVenue( { name: 'Removed venue' } );
		const withVenue = await createEvent( 'removed venue' );
		await fixture( 'event-date', {
			id: withVenue.id,
			columns: { venue_id: venueId },
		} );
		await fixture( 'delete-venue', { id: venueId } );
		const missingVenue = await facts( withVenue.id );
		expect( missingVenue.status() ).toBe( 500 );
		expect( ( await missingVenue.json() ).code ).toBe(
			'fair_events_venue_missing'
		);

		// A linked page that no longer exists.
		const withPage = await createEvent( 'removed page' );
		await fixture( 'link', {
			event_date_id: withPage.id,
			post_id: 2147480001,
		} );
		const missingPage = await facts( withPage.id );
		await fixture( 'unlink', {
			event_date_id: withPage.id,
			post_id: 2147480001,
		} );
		expect( missingPage.status() ).toBe( 500 );
		expect( ( await missingPage.json() ).code ).toBe(
			'fair_events_linked_page_missing'
		);

		// A generated occurrence whose series master is missing.
		const master = await createEvent( 'broken series', {
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		const child = ( await readEventDate( master.id ) )
			.generated_occurrences[ 0 ];
		eventDateIds.push( child.id );
		await fixture( 'event-date', {
			id: child.id,
			columns: { master_id: 2147480002 },
		} );
		const missingMaster = await facts( child.id );
		await fixture( 'event-date', {
			id: child.id,
			columns: { master_id: master.id },
		} );
		expect( missingMaster.status() ).toBe( 500 );
		expect( ( await missingMaster.json() ).code ).toBe(
			'fair_events_series_master_missing'
		);

		// A title the source holds empty is invalid, not unknown.
		const untitled = await createEvent( 'untitled' );
		await fixture( 'event-date', {
			id: untitled.id,
			columns: { title: '' },
		} );
		const noTitle = await facts( untitled.id );
		expect( noTitle.status() ).toBe( 422 );
		expect( ( await noTitle.json() ).code ).toBe(
			'fair_events_campaign_facts_title_missing'
		);
	} );
} );
