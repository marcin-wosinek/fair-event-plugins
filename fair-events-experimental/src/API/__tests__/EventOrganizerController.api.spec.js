/**
 * Playwright API tests for EventOrganizerController (#2305): the organizer
 * assigned to an event, GET/PUT /fair-events/v1/event-dates/{id}/organizer,
 * and the organizer named in the event's public JSON-LD.
 *
 * Covers the sitewide fallback for existing events, assignment and reset,
 * rejected IDs that leave the saved assignment unchanged, access
 * restrictions, a series sharing its master's organizer (also after its
 * dates are regenerated), the JSON-LD identity of an assigned, default and
 * missing organizer, and the `organizers` bundle restoring sitewide
 * behaviour while keeping every assignment.
 *
 * Also covers choosing the organizer when creating an event
 * (POST /fair-events/v1/event-dates with `organizer_id`) and the picker
 * options a new event uses (GET /fair-events/v1/event-organizers):
 * a refused choice creates nothing, and a series stores it on its master.
 *
 * The suite removes the events, posts, organizers and user it creates.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const ORGANIZERS_PATH = '/wp-json/fair-events/v1/organizers';
const EVENT_DATES_PATH = '/wp-json/fair-events/v1/event-dates';
const SETTINGS_PATH = '/wp-json/wp/v2/settings';
const INDEX_OPTION = 'fair_events_experimental_organizer_ids';
const OPTION_PREFIX = 'fair_events_experimental_organizer_';
const FEATURES_OPTION = 'fair_events_experimental_features';
const EDITOR_PASSWORD = 'Test-password-2305!';
const MISSING_ID = '00000000-0000-4000-8000-000000000000';
const PRIVATE_EMAIL = 'north-board@example.com';

const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminHeaders = basic( ADMIN_USER, ADMIN_PASSWORD );

const organizerPath = ( id ) => `${ EVENT_DATES_PATH }/${ id }/organizer`;

/** Run WP-CLI on the tests instance without blocking the event loop. */
async function wp( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', 'wp', ...args ],
		{
			cwd: new URL( '../../../../', import.meta.url ),
			encoding: 'utf8',
		}
	);
	return stdout;
}

/** Number of event date rows with a title. */
async function rowsTitled( title ) {
	const out = await wp(
		'eval',
		`global $wpdb; echo 'ROWS:' . (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE title = %s', $wpdb->prefix . 'fair_event_dates', ${ JSON.stringify(
			title
		) } ) );`
	);
	return Number( out.match( /ROWS:(\d+)/ )[ 1 ] );
}

/** Raw organizer_id column of an event date row, '' when NULL. */
async function storedOrganizerId( eventDateId ) {
	const out = await wp(
		'eval',
		`global $wpdb; echo 'ORGANIZER:' . (string) $wpdb->get_var( $wpdb->prepare( 'SELECT organizer_id FROM %i WHERE id = %d', $wpdb->prefix . 'fair_event_dates', ${ Number(
			eventDateId
		) } ) );`
	);
	return out.match( /ORGANIZER:(\S*)/ )[ 1 ];
}

test.describe( 'EventOrganizerController', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let editorId;
	let editorHeaders;
	let north;
	let south;
	const organizerIds = [];
	const eventDateIds = [];
	const postIds = [];

	const read = ( id, headers = adminHeaders ) =>
		api.get( organizerPath( id ), { headers } );
	const assign = ( id, data, headers = adminHeaders ) =>
		api.put( organizerPath( id ), { headers, data } );

	const createOrganizer = async ( data ) => {
		const res = await api.post( ORGANIZERS_PATH, {
			headers: adminHeaders,
			data,
		} );
		expect( res.status(), await res.text() ).toBe( 201 );
		const body = await res.json();
		organizerIds.push( body.id );
		return body;
	};

	/**
	 * Create an event date, optionally a series or linked to a published
	 * post.
	 *
	 * @param {Object}  options
	 * @param {string}  [options.rrule]  Recurrence rule for a series.
	 * @param {boolean} [options.linked] Link to a new published post.
	 * @return {Promise<Object>} `{ id, occurrenceIds, postId }`.
	 */
	const createEvent = async ( { rrule, linked = false } = {} ) => {
		const title = `Organizer event ${ Date.now() } ${ Math.random() }`;
		const res = await api.post( EVENT_DATES_PATH, {
			headers: adminHeaders,
			data: {
				title,
				start_date: '2035-09-03',
				start_time: '18:00:00',
				end_date: '2035-09-03',
				end_time: '20:00:00',
				...( rrule ? { rrule } : {} ),
			},
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		const occurrenceIds = ( body.generated_occurrences || [] ).map(
			( o ) => o.id
		);
		eventDateIds.push( body.id, ...occurrenceIds );

		let postId = null;
		if ( linked ) {
			const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
				headers: adminHeaders,
				data: { title, status: 'publish' },
			} );
			expect( postRes.ok() ).toBeTruthy();
			postId = ( await postRes.json() ).id;
			postIds.push( postId );
			const linkRes = await api.put(
				`${ EVENT_DATES_PATH }/${ body.id }`,
				{
					headers: adminHeaders,
					data: { event_id: postId, link_type: 'post' },
				}
			);
			expect( linkRes.ok(), await linkRes.text() ).toBeTruthy();
		}

		return { id: body.id, occurrenceIds, postId };
	};

	/**
	 * POST a new event date, tracking whatever it creates for cleanup.
	 *
	 * @param {Object} extra     Extra request fields.
	 * @param {Object} [headers] Request headers.
	 * @return {Promise<Object>} `{ res, body, title }`.
	 */
	const postEvent = async ( extra, headers = adminHeaders ) => {
		const title = `Created organizer event ${ Date.now() } ${ Math.random() }`;
		const res = await api.post( EVENT_DATES_PATH, {
			headers,
			data: {
				title,
				start_date: '2035-10-01',
				start_time: '18:00:00',
				end_date: '2035-10-01',
				end_time: '20:00:00',
				...extra,
			},
		} );
		const body = await res.json();
		if ( res.ok() ) {
			eventDateIds.push(
				body.id,
				...( body.generated_occurrences || [] ).map( ( o ) => o.id )
			);
		}
		return { res, body, title };
	};

	/** The Event JSON-LD node on a post's public page. */
	const eventJsonLd = async ( postId ) => {
		const post = await (
			await api.get( `/wp-json/wp/v2/fair_event/${ postId }`, {
				headers: adminHeaders,
			} )
		).json();
		const html = await ( await api.get( post.link ) ).text();
		const nodes = [
			...html.matchAll(
				/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g
			),
		].map( ( match ) => JSON.parse( match[ 1 ] ) );
		return {
			html,
			event: nodes.find( ( node ) => 'Event' === node[ '@type' ] ),
			organization: nodes.find( ( node ) =>
				String( node[ '@id' ] || '' ).endsWith( '#organization' )
			),
		};
	};

	const setOrganizersBundle = ( enabled ) =>
		wp(
			'option',
			'update',
			FEATURES_OPTION,
			JSON.stringify( { organizers: enabled } ),
			'--format=json'
		);

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		// The bundle is off by default; this suite assigns organizers.
		await setOrganizersBundle( true );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: {
				fair_events_organizer: {
					name: 'Sitewide Club',
					notification_emails: [ 'sitewide-board@example.com' ],
				},
			},
		} );

		north = await createOrganizer( {
			name: 'North Club',
			type: 'SportsClub',
			website: 'https://north.example',
			address_locality: 'Bilbao',
			contact_email: 'hello@north.example',
			notification_emails: [ PRIVATE_EMAIL ],
		} );
		south = await createOrganizer( { name: 'South Club' } );

		const login = `event-organizer-${ Date.now() }`;
		const userRes = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.com`,
				password: EDITOR_PASSWORD,
				roles: [ 'editor' ],
			},
		} );
		expect( userRes.ok() ).toBeTruthy();
		editorId = ( await userRes.json() ).id;
		editorHeaders = basic( login, EDITOR_PASSWORD );
	} );

	test.afterAll( async () => {
		await wp( 'option', 'delete', FEATURES_OPTION ).catch( () => {} );
		for ( const id of [ ...eventDateIds ].reverse() ) {
			await api.delete( `${ EVENT_DATES_PATH }/${ id }`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of postIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of organizerIds ) {
			await wp( 'option', 'delete', OPTION_PREFIX + id ).catch(
				() => {}
			);
		}
		await wp( 'option', 'delete', INDEX_OPTION ).catch( () => {} );
		await api.post( SETTINGS_PATH, {
			headers: adminHeaders,
			data: { fair_events_organizer: {} },
		} );
		if ( editorId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ editorId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'an existing event uses the sitewide organizer, with name-only options', async () => {
		const event = await createEvent();

		const res = await read( event.id );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body ).toMatchObject( {
			organizer_id: 'default',
			effective_organizer_id: 'default',
			series_event_date_id: null,
		} );
		expect( body.organizers.slice( 0, 1 ) ).toEqual( [
			{ id: 'default', name: 'Sitewide Club', is_default: true },
		] );
		expect( body.organizers ).toContainEqual( {
			id: north.id,
			name: 'North Club',
			is_default: false,
		} );
		for ( const option of body.organizers ) {
			expect( Object.keys( option ).sort() ).toEqual( [
				'id',
				'is_default',
				'name',
			] );
		}
		expect( JSON.stringify( body ) ).not.toContain( PRIVATE_EMAIL );
		expect( await storedOrganizerId( event.id ) ).toBe( '' );
	} );

	test( 'assigns an organizer and resets it to the sitewide default', async () => {
		const event = await createEvent();

		const assigned = await assign( event.id, { organizer_id: north.id } );
		expect( assigned.status() ).toBe( 200 );
		expect( await assigned.json() ).toMatchObject( {
			organizer_id: north.id,
			effective_organizer_id: north.id,
		} );
		expect( ( await ( await read( event.id ) ).json() ).organizer_id ).toBe(
			north.id
		);

		const reset = await assign( event.id, { organizer_id: 'default' } );
		expect( reset.status() ).toBe( 200 );
		expect( ( await reset.json() ).organizer_id ).toBe( 'default' );
		expect( await storedOrganizerId( event.id ) ).toBe( '' );
	} );

	test( 'rejects malformed, unknown and missing IDs without changing the assignment', async () => {
		const event = await createEvent();
		await assign( event.id, { organizer_id: south.id } );

		for ( const data of [
			{ organizer_id: 'not-a-uuid' },
			{ organizer_id: MISSING_ID },
			{ organizer_id: '' },
			{ organizer_id: 42 },
			{},
		] ) {
			const res = await assign( event.id, data );
			expect( res.status(), JSON.stringify( data ) ).toBe( 400 );
		}

		const unknown = await assign( event.id, { organizer_id: MISSING_ID } );
		expect( ( await unknown.json() ).code ).toBe(
			'rest_invalid_organizer'
		);
		expect( await storedOrganizerId( event.id ) ).toBe( south.id );
	} );

	test( 'only administrators read or change an event organizer', async () => {
		const event = await createEvent();
		const anon = await request.newContext( { baseURL: BASE_URL } );

		expect( ( await anon.get( organizerPath( event.id ) ) ).status() ).toBe(
			401
		);
		expect(
			(
				await anon.put( organizerPath( event.id ), {
					data: { organizer_id: north.id },
				} )
			).status()
		).toBe( 401 );
		expect( ( await read( event.id, editorHeaders ) ).status() ).toBe(
			403
		);
		expect(
			(
				await assign(
					event.id,
					{ organizer_id: north.id },
					editorHeaders
				)
			).status()
		).toBe( 403 );
		await anon.dispose();

		expect( await storedOrganizerId( event.id ) ).toBe( '' );
	} );

	test( 'a missing event date is 404', async () => {
		const res = await read( 999999999 );
		expect( res.status() ).toBe( 404 );
		expect( ( await res.json() ).code ).toBe( 'rest_event_date_not_found' );
	} );

	test( 'a series shares its organizer, also after its dates are regenerated', async () => {
		const series = await createEvent( { rrule: 'FREQ=WEEKLY;COUNT=3' } );
		expect( series.occurrenceIds.length ).toBeGreaterThan( 0 );
		const [ occurrenceId ] = series.occurrenceIds;

		await assign( series.id, { organizer_id: north.id } );

		const fromOccurrence = await ( await read( occurrenceId ) ).json();
		expect( fromOccurrence ).toMatchObject( {
			organizer_id: north.id,
			effective_organizer_id: north.id,
			series_event_date_id: series.id,
		} );

		const refused = await assign( occurrenceId, {
			organizer_id: south.id,
		} );
		expect( refused.status() ).toBe( 409 );
		expect( ( await refused.json() ).code ).toBe(
			'rest_organizer_managed_on_series'
		);
		expect( await storedOrganizerId( occurrenceId ) ).toBe( '' );
		expect( await storedOrganizerId( series.id ) ).toBe( north.id );

		const regenerated = await api.put(
			`${ EVENT_DATES_PATH }/${ series.id }`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=5' },
			}
		);
		const body = await regenerated.json();
		expect( regenerated.ok(), JSON.stringify( body ) ).toBeTruthy();
		const newIds = ( body.generated_occurrences || [] ).map(
			( o ) => o.id
		);
		eventDateIds.push( ...newIds );
		expect( newIds.length ).toBeGreaterThan( series.occurrenceIds.length );

		expect( await storedOrganizerId( series.id ) ).toBe( north.id );
		const last = await ( await read( newIds[ newIds.length - 1 ] ) ).json();
		expect( last.organizer_id ).toBe( north.id );
	} );

	test( 'lists name-only organizer options for a new event to administrators', async () => {
		const res = await api.get( '/wp-json/fair-events/v1/event-organizers', {
			headers: adminHeaders,
		} );
		expect( res.status() ).toBe( 200 );
		const body = await res.json();
		expect( body.organizer_id ).toBe( 'default' );
		expect( body.organizers[ 0 ] ).toEqual( {
			id: 'default',
			name: 'Sitewide Club',
			is_default: true,
		} );
		expect( body.organizers ).toContainEqual( {
			id: north.id,
			name: 'North Club',
			is_default: false,
		} );
		expect( JSON.stringify( body ) ).not.toContain( PRIVATE_EMAIL );

		const anon = await request.newContext( { baseURL: BASE_URL } );
		expect(
			(
				await anon.get( '/wp-json/fair-events/v1/event-organizers' )
			).status()
		).toBe( 401 );
		await anon.dispose();
		expect(
			(
				await api.get( '/wp-json/fair-events/v1/event-organizers', {
					headers: editorHeaders,
				} )
			).status()
		).toBe( 403 );
	} );

	test( 'stores the organizer chosen when creating an event', async () => {
		const chosen = await postEvent( { organizer_id: north.id } );
		expect( chosen.res.status(), JSON.stringify( chosen.body ) ).toBe(
			201
		);
		expect( await storedOrganizerId( chosen.body.id ) ).toBe( north.id );
		expect( await ( await read( chosen.body.id ) ).json() ).toMatchObject( {
			organizer_id: north.id,
			effective_organizer_id: north.id,
		} );

		const sitewide = await postEvent( { organizer_id: 'default' } );
		expect( sitewide.res.status() ).toBe( 201 );
		expect( await storedOrganizerId( sitewide.body.id ) ).toBe( '' );
	} );

	test( 'refuses an invalid organizer at creation without creating anything', async () => {
		for ( const organizerId of [ MISSING_ID, 'not-a-uuid', '', 42 ] ) {
			const { res, body, title } = await postEvent( {
				organizer_id: organizerId,
				rrule: 'FREQ=WEEKLY;COUNT=3',
			} );
			expect( res.status(), JSON.stringify( organizerId ) ).toBe( 400 );
			expect( body.code ).toBe( 'rest_invalid_organizer' );
			expect( await rowsTitled( title ) ).toBe( 0 );
		}
	} );

	test( 'only administrators choose an organizer at creation', async () => {
		const refused = await postEvent(
			{ organizer_id: north.id },
			editorHeaders
		);
		expect( refused.res.status() ).toBe( 403 );
		expect( await rowsTitled( refused.title ) ).toBe( 0 );

		// Editors still create events, with the sitewide organizer.
		const plain = await postEvent( {}, editorHeaders );
		expect( plain.res.status(), JSON.stringify( plain.body ) ).toBe( 201 );
		expect( await storedOrganizerId( plain.body.id ) ).toBe( '' );
	} );

	test( 'a series created with an organizer shares it with its dates', async () => {
		const { res, body } = await postEvent( {
			organizer_id: south.id,
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		expect( res.status(), JSON.stringify( body ) ).toBe( 201 );
		const occurrenceIds = ( body.generated_occurrences || [] ).map(
			( o ) => o.id
		);
		expect( occurrenceIds.length ).toBeGreaterThan( 0 );

		expect( await storedOrganizerId( body.id ) ).toBe( south.id );
		expect( await storedOrganizerId( occurrenceIds[ 0 ] ) ).toBe( '' );
		expect(
			await ( await read( occurrenceIds[ 0 ] ) ).json()
		).toMatchObject( {
			organizer_id: south.id,
			effective_organizer_id: south.id,
			series_event_date_id: body.id,
		} );
	} );

	test( 'public JSON-LD names the assigned, default or fallback organizer', async () => {
		const event = await createEvent( { linked: true } );

		const before = await eventJsonLd( event.postId );
		expect( before.event.organizer[ '@id' ] ).toMatch( /#organization$/ );
		expect( before.event.organizer.name ).toBe( 'Sitewide Club' );

		await assign( event.id, { organizer_id: north.id } );
		const assigned = await eventJsonLd( event.postId );
		expect( assigned.event.organizer ).toMatchObject( {
			'@type': 'SportsClub',
			'@id': expect.stringMatching(
				new RegExp( `#organizer-${ north.id }$` )
			),
			name: 'North Club',
			url: 'https://north.example',
			address: { addressLocality: 'Bilbao' },
			contactPoint: { email: 'hello@north.example' },
		} );
		// The sitewide identity node stays as it is.
		expect( assigned.organization.name ).toBe( 'Sitewide Club' );
		expect( assigned.html ).not.toContain( PRIVATE_EMAIL );
		expect( assigned.html ).not.toContain( 'sitewide-board@example.com' );

		await assign( event.id, { organizer_id: south.id } );
		const other = await eventJsonLd( event.postId );
		expect( other.event.organizer[ '@id' ] ).toMatch(
			new RegExp( `#organizer-${ south.id }$` )
		);
		expect( other.event.organizer[ '@id' ] ).not.toBe(
			assigned.event.organizer[ '@id' ]
		);

		// A stored organizer that no longer resolves falls back to the
		// sitewide one and stays saved.
		await wp(
			'eval',
			`global $wpdb; $wpdb->update( $wpdb->prefix . 'fair_event_dates', array( 'organizer_id' => '${ MISSING_ID }' ), array( 'id' => ${ Number(
				event.id
			) } ) );`
		);
		const missing = await eventJsonLd( event.postId );
		expect( missing.event.organizer[ '@id' ] ).toMatch( /#organization$/ );
		expect( await ( await read( event.id ) ).json() ).toMatchObject( {
			organizer_id: MISSING_ID,
			effective_organizer_id: 'default',
		} );
		expect( await storedOrganizerId( event.id ) ).toBe( MISSING_ID );
	} );

	test( 'turning organizers off restores the sitewide organizer and keeps assignments', async () => {
		const event = await createEvent( { linked: true } );
		await assign( event.id, { organizer_id: north.id } );

		await setOrganizersBundle( false );
		try {
			expect( ( await read( event.id ) ).status() ).toBe( 404 );
			const off = await eventJsonLd( event.postId );
			expect( off.event.organizer[ '@id' ] ).toMatch( /#organization$/ );
			expect( off.html ).not.toContain( 'North Club' );
			expect( await storedOrganizerId( event.id ) ).toBe( north.id );

			// Creation ignores an organizer while the bundle is off.
			const created = await postEvent( { organizer_id: north.id } );
			expect( created.res.status() ).toBe( 201 );
			expect( await storedOrganizerId( created.body.id ) ).toBe( '' );
		} finally {
			await setOrganizersBundle( true );
		}

		expect( ( await ( await read( event.id ) ).json() ).organizer_id ).toBe(
			north.id
		);
		const on = await eventJsonLd( event.postId );
		expect( on.event.organizer.name ).toBe( 'North Club' );
	} );
} );
