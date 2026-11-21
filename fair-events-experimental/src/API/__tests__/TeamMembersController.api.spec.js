/**
 * Playwright API tests for the team member directory (#2394):
 * TeamMembersController (`/fair-events/v1/team-members`) and
 * EventTeamMembersController (`/fair-events/v1/event-dates/{id}/team-members`).
 *
 * Covers administrator-only access, the `team-members` bundle hiding every
 * route while keeping profiles and memberships, validation and clearing of
 * optional fields, duplicate links, one profile reused across events,
 * deletion blocked while linked, membership cleanup when an event is
 * deleted, a series' team shared by existing, newly generated and past
 * dates (read-only there), and independent teams on event copies.
 *
 * The suite removes the events, profiles and user it creates.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const PATH = '/wp-json/fair-events/v1/team-members';
const EVENT_DATES_PATH = '/wp-json/fair-events/v1/event-dates';
const FEATURES_OPTION = 'fair_events_experimental_features';
const EDITOR_PASSWORD = 'Test-password-2394!';
const PRIVATE_EMAIL = 'ana.private@example.com';
const PRIVATE_PHONE = '+34 600 111 222';

const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminHeaders = basic( ADMIN_USER, ADMIN_PASSWORD );

const teamPath = ( id ) => `${ EVENT_DATES_PATH }/${ id }/team-members`;

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

/** Evaluate PHP on the tests instance and parse the JSON it echoes after `JSON:`. */
async function evalJson( php ) {
	const out = await wp( 'eval', php );
	return JSON.parse( out.slice( out.indexOf( 'JSON:' ) + 5 ).trim() );
}

/** Raw membership rows owned by an event date. */
const storedMemberIds = ( ownerId ) =>
	evalJson(
		`global $wpdb; echo 'JSON:' . wp_json_encode( array_map( 'intval', $wpdb->get_col( $wpdb->prepare( 'SELECT member_id FROM %i WHERE owner_event_date_id = %d ORDER BY member_id', $wpdb->prefix . 'fair_events_team_memberships', ${ Number(
			ownerId
		) } ) ) ) );`
	);

const setBundle = ( enabled ) =>
	wp(
		'option',
		'update',
		FEATURES_OPTION,
		JSON.stringify( { 'team-members': enabled } ),
		'--format=json'
	);

test.describe( 'TeamMembersController', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let editorId;
	let editorHeaders;
	const memberIds = [];
	const eventDateIds = [];

	const create = ( data, headers = adminHeaders ) =>
		api.post( PATH, { headers, data } );
	const createOk = async ( data ) => {
		const res = await create( data );
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 201 );
		memberIds.push( body.id );
		return body;
	};
	const readTeam = ( id ) =>
		api.get( teamPath( id ), { headers: adminHeaders } );
	const link = ( id, memberId ) =>
		api.post( teamPath( id ), {
			headers: adminHeaders,
			data: { member_id: memberId },
		} );
	const unlink = ( id, memberId ) =>
		api.delete( `${ teamPath( id ) }/${ memberId }`, {
			headers: adminHeaders,
		} );

	/**
	 * Create an event date, optionally a series.
	 *
	 * @param {Object} options
	 * @param {string} [options.rrule]     Recurrence rule for a series.
	 * @param {string} [options.startDate] First date.
	 * @return {Promise<Object>} `{ id, occurrenceIds }`.
	 */
	const createEvent = async ( { rrule, startDate = '2035-09-03' } = {} ) => {
		const res = await api.post( EVENT_DATES_PATH, {
			headers: adminHeaders,
			data: {
				title: `Team event ${ Date.now() } ${ Math.random() }`,
				start_date: startDate,
				start_time: '18:00:00',
				end_date: startDate,
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
		return { id: body.id, occurrenceIds };
	};

	/** Copy an event with Fair Events' copy service; returns the copy's event date ID. */
	const copyEvent = async ( id, failAt = null ) => {
		const result = await evalJson( `
			${
				failAt
					? `add_filter( 'fair_events_event_copy_fail_at', static function ( $fail, $checkpoint ) { return $fail || ${ JSON.stringify(
							failAt
						) } === $checkpoint; }, 10, 2 );`
					: ''
			}
			$source = \\FairEvents\\Services\\EventCopyService::resolve_source( ${ Number(
				id
			) }, false );
			$copy = ( new \\FairEvents\\Services\\EventCopyService() )->copy( $source, 'Team copy ' . wp_generate_password( 6, false ), array( 'start_date' => '2036-01-14', 'end_date' => '2036-01-14', 'start_time' => '18:00:00', 'end_time' => '20:00:00' ) );
			echo 'JSON:' . wp_json_encode( is_wp_error( $copy ) ? array( 'error' => $copy->get_error_code() ) : $copy );
		` );
		if ( result.event_date_id ) {
			eventDateIds.push( result.event_date_id );
		}
		return result;
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		// The bundle is off by default; this suite manages team members.
		await setBundle( true );

		const login = `team-members-${ Date.now() }`;
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
		await setBundle( true );
		for ( const id of [ ...eventDateIds ].reverse() ) {
			await api.delete( `${ EVENT_DATES_PATH }/${ id }`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of memberIds ) {
			await api.delete( `${ PATH }/${ id }`, { headers: adminHeaders } );
		}
		await wp( 'option', 'delete', FEATURES_OPTION ).catch( () => {} );
		if ( editorId ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ editorId }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'every route is restricted to administrators', async () => {
		const member = await createOk( { name: 'Guarded' } );
		const event = await createEvent();
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const calls = [
			[ 'get', PATH, undefined ],
			[ 'post', PATH, { name: 'Blocked' } ],
			[ 'get', `${ PATH }/${ member.id }`, undefined ],
			[ 'put', `${ PATH }/${ member.id }`, { name: 'Blocked' } ],
			[ 'delete', `${ PATH }/${ member.id }`, undefined ],
			[ 'get', teamPath( event.id ), undefined ],
			[ 'post', teamPath( event.id ), { member_id: member.id } ],
			[ 'delete', `${ teamPath( event.id ) }/${ member.id }`, undefined ],
		];

		for ( const [ method, path, data ] of calls ) {
			const anonymous = await anon[ method ]( path, { data } );
			expect( anonymous.status(), `${ method } ${ path }` ).toBe( 401 );

			const editor = await api[ method ]( path, {
				headers: editorHeaders,
				data,
			} );
			expect( editor.status(), `${ method } ${ path }` ).toBe( 403 );
		}
		await anon.dispose();

		expect( await storedMemberIds( event.id ) ).toEqual( [] );
		const kept = await api.get( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
		} );
		expect( ( await kept.json() ).name ).toBe( 'Guarded' );
	} );

	test( 'creates a profile with every field; only the name is required', async () => {
		const full = await createOk( {
			name: ' Ana ',
			surname: 'Ruiz',
			instagram: '@ana.dances',
			email: PRIVATE_EMAIL,
			facebook_url: 'https://www.facebook.com/ana.ruiz',
			phone: PRIVATE_PHONE,
			gender: 'female',
		} );
		expect( full ).toMatchObject( {
			name: 'Ana',
			surname: 'Ruiz',
			instagram: '@ana.dances',
			email: PRIVATE_EMAIL,
			facebook_url: 'https://www.facebook.com/ana.ruiz',
			phone: PRIVATE_PHONE,
			gender: 'female',
			event_count: 0,
			events: [],
		} );

		const minimal = await createOk( { name: 'Sam' } );
		expect( minimal ).toMatchObject( {
			surname: '',
			email: '',
			facebook_url: '',
			phone: '',
			gender: null,
		} );

		const listed = await (
			await api.get( PATH, { headers: adminHeaders } )
		).json();
		expect( listed.map( ( m ) => m.id ) ).toEqual(
			expect.arrayContaining( [ full.id, minimal.id ] )
		);
	} );

	test( 'rejects invalid fields together and stores nothing', async () => {
		const before = (
			await ( await api.get( PATH, { headers: adminHeaders } ) ).json()
		).length;

		const res = await create( {
			name: '   ',
			email: 'not-an-email',
			facebook_url: 'https://example.com/ana',
			gender: 'other',
		} );
		expect( res.status() ).toBe( 400 );
		const body = await res.json();
		expect( body.code ).toBe( 'rest_invalid_param' );
		expect( Object.keys( body.data.params ).sort() ).toEqual( [
			'email',
			'facebook_url',
			'gender',
			'name',
		] );

		for ( const facebook of [
			'facebook.com/ana',
			'ftp://www.facebook.com/ana',
			'https://www.facebook.com/',
		] ) {
			const rejected = await create( {
				name: 'Ana',
				facebook_url: facebook,
			} );
			expect( rejected.status(), facebook ).toBe( 400 );
		}

		const after = (
			await ( await api.get( PATH, { headers: adminHeaders } ) ).json()
		).length;
		expect( after ).toBe( before );
	} );

	test( 'updates only the given fields, clears optional ones and keeps international phones', async () => {
		const member = await createOk( {
			name: 'Marek',
			surname: 'Nowak',
			email: 'marek@example.com',
			facebook_url: 'https://www.facebook.com/profile.php?id=1000',
			phone: '+48 500 000 002',
			gender: 'male',
		} );

		const cleared = await api.put( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
			data: { email: '', facebook_url: '', gender: null },
		} );
		expect( cleared.status() ).toBe( 200 );
		expect( await cleared.json() ).toMatchObject( {
			name: 'Marek',
			surname: 'Nowak',
			email: '',
			facebook_url: '',
			phone: '+48 500 000 002',
			gender: null,
		} );

		const blankName = await api.put( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
			data: { name: '', phone: '+1 555 0100' },
		} );
		expect( blankName.status() ).toBe( 400 );
		const kept = await (
			await api.get( `${ PATH }/${ member.id }`, {
				headers: adminHeaders,
			} )
		).json();
		expect( kept ).toMatchObject( {
			name: 'Marek',
			phone: '+48 500 000 002',
		} );

		const badGender = await api.put( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
			data: { gender: 'unknown' },
		} );
		expect( badGender.status() ).toBe( 400 );

		const missing = await api.put( `${ PATH }/999999999`, {
			headers: adminHeaders,
			data: { name: 'Nobody' },
		} );
		expect( missing.status() ).toBe( 404 );
	} );

	test( 'links several members once each, with name-only responses', async () => {
		const ana = await createOk( {
			name: 'Linked Ana',
			surname: 'Ruiz',
			email: PRIVATE_EMAIL,
			phone: PRIVATE_PHONE,
		} );
		const sam = await createOk( { name: 'Linked Sam' } );
		const event = await createEvent();

		const first = await link( event.id, ana.id );
		expect( first.status() ).toBe( 201 );
		const repeat = await link( event.id, ana.id );
		expect( repeat.status() ).toBe( 200 );
		expect( ( await link( event.id, sam.id ) ).status() ).toBe( 201 );

		const team = await ( await readTeam( event.id ) ).json();
		expect( team ).toMatchObject( {
			owner_event_date_id: event.id,
			series_event_date_id: null,
		} );
		expect( team.members ).toEqual( [
			{ id: ana.id, name: 'Linked Ana', surname: 'Ruiz' },
			{ id: sam.id, name: 'Linked Sam', surname: '' },
		] );
		expect( JSON.stringify( team ) ).not.toContain( PRIVATE_EMAIL );
		expect( JSON.stringify( team ) ).not.toContain( PRIVATE_PHONE );
		expect( await storedMemberIds( event.id ) ).toEqual(
			[ ana.id, sam.id ].sort( ( a, b ) => a - b )
		);

		const unknown = await link( event.id, 999999999 );
		expect( unknown.status() ).toBe( 404 );
		const missingEvent = await link( 999999999, ana.id );
		expect( missingEvent.status() ).toBe( 404 );
	} );

	test( 'reuses one profile across events and shows edits everywhere', async () => {
		const member = await createOk( { name: 'Shared', surname: 'Old' } );
		const one = await createEvent();
		const two = await createEvent();
		await link( one.id, member.id );
		await link( two.id, member.id );

		await api.put( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
			data: { surname: 'New' },
		} );

		for ( const event of [ one, two ] ) {
			const team = await ( await readTeam( event.id ) ).json();
			expect( team.members ).toEqual( [
				{ id: member.id, name: 'Shared', surname: 'New' },
			] );
		}

		const profile = await (
			await api.get( `${ PATH }/${ member.id }`, {
				headers: adminHeaders,
			} )
		).json();
		expect( profile.event_count ).toBe( 2 );
		expect( profile.events.map( ( e ) => e.event_date_id ).sort() ).toEqual(
			[ one.id, two.id ].sort()
		);

		// Unlinking keeps the profile and the other event.
		expect( ( await unlink( one.id, member.id ) ).status() ).toBe( 200 );
		expect( ( await unlink( one.id, member.id ) ).status() ).toBe( 200 );
		expect( await storedMemberIds( one.id ) ).toEqual( [] );
		expect( await storedMemberIds( two.id ) ).toEqual( [ member.id ] );
		const after = await api.get( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
		} );
		expect( ( await after.json() ).event_count ).toBe( 1 );
	} );

	test( 'blocks deletion until every event link is removed', async () => {
		const member = await createOk( { name: 'Busy' } );
		const event = await createEvent();
		await link( event.id, member.id );

		const blocked = await api.delete( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
		} );
		expect( blocked.status() ).toBe( 409 );
		const body = await blocked.json();
		expect( body.code ).toBe( 'rest_team_member_linked' );
		expect( body.data.events ).toEqual( [
			expect.objectContaining( { event_date_id: event.id } ),
		] );
		expect( await storedMemberIds( event.id ) ).toEqual( [ member.id ] );

		await unlink( event.id, member.id );
		const deleted = await api.delete( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
		} );
		expect( deleted.status() ).toBe( 200 );
		const gone = await api.get( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
		} );
		expect( gone.status() ).toBe( 404 );
		// Linking a deleted profile is refused.
		expect( ( await link( event.id, member.id ) ).status() ).toBe( 404 );
	} );

	test( 'deleting an event removes its memberships and keeps the profiles', async () => {
		const member = await createOk( { name: 'Outlives event' } );
		const event = await createEvent();
		await link( event.id, member.id );

		const deleted = await api.delete(
			`${ EVENT_DATES_PATH }/${ event.id }`,
			{
				headers: adminHeaders,
			}
		);
		expect( deleted.ok() ).toBeTruthy();
		expect( await storedMemberIds( event.id ) ).toEqual( [] );

		const profile = await (
			await api.get( `${ PATH }/${ member.id }`, {
				headers: adminHeaders,
			} )
		).json();
		expect( profile.event_count ).toBe( 0 );
	} );

	test( 'a series shares its team with every date, including past and newly generated ones', async () => {
		const member = await createOk( { name: 'Series', surname: 'Lead' } );
		const other = await createOk( { name: 'Occurrence', surname: 'Only' } );
		const past = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=3',
			startDate: '2020-01-06',
		} );
		expect( past.occurrenceIds.length ).toBeGreaterThan( 0 );
		const [ occurrenceId ] = past.occurrenceIds;

		await link( past.id, member.id );

		const fromPast = await ( await readTeam( occurrenceId ) ).json();
		expect( fromPast ).toMatchObject( {
			owner_event_date_id: past.id,
			series_event_date_id: past.id,
			members: [ { id: member.id, name: 'Series', surname: 'Lead' } ],
		} );

		// Writes on a date of the series are refused and change nothing.
		const refusedAdd = await link( occurrenceId, other.id );
		expect( refusedAdd.status() ).toBe( 409 );
		const refusedBody = await refusedAdd.json();
		expect( refusedBody.code ).toBe( 'rest_team_managed_on_series' );
		expect( refusedBody.data.series_event_date_id ).toBe( past.id );
		const refusedRemove = await unlink( occurrenceId, member.id );
		expect( refusedRemove.status() ).toBe( 409 );
		expect( await storedMemberIds( occurrenceId ) ).toEqual( [] );
		expect( await storedMemberIds( past.id ) ).toEqual( [ member.id ] );

		// Dates generated after the team was set read it too.
		const regenerated = await api.put(
			`${ EVENT_DATES_PATH }/${ past.id }`,
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
		const last = newIds[ newIds.length - 1 ];
		expect( ( await ( await readTeam( last ) ).json() ).members ).toEqual( [
			{ id: member.id, name: 'Series', surname: 'Lead' },
		] );

		// Changing the series' team changes every date, past ones included.
		await link( past.id, other.id );
		await unlink( past.id, member.id );
		for ( const id of [ occurrenceId, last ] ) {
			expect(
				( await ( await readTeam( id ) ).json() ).members.map(
					( m ) => m.id
				)
			).toEqual( [ other.id ] );
		}
	} );

	test( 'an event copy starts with its source team and is independent afterwards', async () => {
		const ana = await createOk( { name: 'Copy Ana' } );
		const sam = await createOk( { name: 'Copy Sam' } );
		const lee = await createOk( { name: 'Copy Lee' } );
		const source = await createEvent( { rrule: 'FREQ=WEEKLY;COUNT=2' } );
		await link( source.id, ana.id );
		await link( source.id, sam.id );

		const copy = await copyEvent( source.id );
		expect( copy.event_date_id, JSON.stringify( copy ) ).toBeTruthy();
		expect( await storedMemberIds( copy.event_date_id ) ).toEqual(
			[ ana.id, sam.id ].sort( ( a, b ) => a - b )
		);

		await link( copy.event_date_id, lee.id );
		await unlink( copy.event_date_id, ana.id );
		await unlink( source.id, sam.id );

		expect( await storedMemberIds( source.id ) ).toEqual( [ ana.id ] );
		expect( await storedMemberIds( copy.event_date_id ) ).toEqual(
			[ sam.id, lee.id ].sort( ( a, b ) => a - b )
		);
	} );

	test( 'a copy made while the bundle is off still gets the team, and a failed copy leaves none', async () => {
		const member = await createOk( { name: 'Copied while off' } );
		const source = await createEvent();
		await link( source.id, member.id );
		const countRows = () =>
			evalJson(
				`global $wpdb; echo 'JSON:' . (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $wpdb->prefix . 'fair_events_team_memberships' ) );`
			);

		await setBundle( false );
		try {
			const copy = await copyEvent( source.id );
			expect( copy.event_date_id, JSON.stringify( copy ) ).toBeTruthy();
			expect( await storedMemberIds( copy.event_date_id ) ).toEqual( [
				member.id,
			] );

			const before = await countRows();
			const failed = await copyEvent( source.id, 'extension_copying' );
			expect( failed.error ).toBe( 'event_copy_failed' );
			expect( await countRows() ).toBe( before );
		} finally {
			await setBundle( true );
		}
	} );

	test( 'turning the bundle off hides every route and keeps profiles and teams', async () => {
		const member = await createOk( {
			name: 'Kept',
			surname: 'Published',
			email: PRIVATE_EMAIL,
		} );
		const event = await createEvent();
		await link( event.id, member.id );

		await setBundle( false );
		try {
			const calls = [
				[ 'get', PATH ],
				[ 'get', `${ PATH }/${ member.id }` ],
				[ 'get', teamPath( event.id ) ],
				[ 'post', teamPath( event.id ) ],
			];
			for ( const [ method, path ] of calls ) {
				const res = await api[ method ]( path, {
					headers: adminHeaders,
					data: { member_id: member.id },
				} );
				expect( res.status(), `${ method } ${ path }` ).toBe( 404 );
			}

			// Names stay resolvable for marketing consumers (#2396); nothing else.
			const names = await evalJson(
				`echo 'JSON:' . wp_json_encode( \\FairEventsExperimental\\Services\\TeamMembership::published_names( array( ${ member.id }, 999999999 ) ) );`
			);
			expect( names ).toEqual( {
				[ member.id ]: {
					id: member.id,
					name: 'Kept',
					surname: 'Published',
				},
			} );
		} finally {
			await setBundle( true );
		}

		const team = await ( await readTeam( event.id ) ).json();
		expect( team.members ).toEqual( [
			{ id: member.id, name: 'Kept', surname: 'Published' },
		] );
		const profile = await (
			await api.get( `${ PATH }/${ member.id }`, {
				headers: adminHeaders,
			} )
		).json();
		expect( profile.email ).toBe( PRIVATE_EMAIL );
	} );

	test( 'profiles and teams are not exposed on public routes', async () => {
		const member = await createOk( {
			name: 'Hidden',
			email: PRIVATE_EMAIL,
		} );
		const event = await createEvent();
		await link( event.id, member.id );

		const anon = await request.newContext( { baseURL: BASE_URL } );
		const publicEvent = await anon.get(
			`${ EVENT_DATES_PATH }/${ event.id }`
		);
		expect( await publicEvent.text() ).not.toContain( PRIVATE_EMAIL );
		const index = await anon.get( '/wp-json/' );
		expect( await index.text() ).not.toContain( PRIVATE_EMAIL );
		await anon.dispose();
	} );
} );
