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
 * Also covers the promotional website, bio and portrait (#2421) and the
 * campaign-facts reader `PromotionalTeamProfiles::read()`: the exact v1
 * keys, single and duplicate display names, portraits resolved at read
 * time (cleared, trashed, restored, deleted, shared), and disabled, denied,
 * missing and empty reads.
 *
 * The suite removes the events, profiles, attachments and user it creates.
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

/**
 * Create a synthetic attachment (no file is uploaded) and return its ID.
 *
 * @param {string} mime MIME type.
 * @return {Promise<number>} Attachment ID.
 */
const createAttachment = async ( mime = 'image/png' ) => {
	const file = `team-2421/portrait-${ Date.now() }-${ Math.random()
		.toString( 36 )
		.slice( 2 ) }.${ mime === 'image/png' ? 'png' : 'pdf' }`;
	const result = await evalJson(
		`$id = wp_insert_attachment( array( 'post_title' => 'Portrait 2421', 'post_mime_type' => '${ mime }', 'post_status' => 'inherit' ), '${ file }' ); wp_update_attachment_metadata( $id, array( 'width' => 400, 'height' => 500, 'file' => '${ file }' ) ); echo 'JSON:' . wp_json_encode( array( 'id' => $id ) );`
	);
	return result.id;
};

/** Set an attachment's post status (`trash`, `inherit`). */
const setAttachmentStatus = ( id, status ) =>
	evalJson(
		`global $wpdb; $wpdb->update( $wpdb->posts, array( 'post_status' => '${ status }' ), array( 'ID' => ${ Number(
			id
		) } ) ); clean_post_cache( ${ Number(
			id
		) } ); echo 'JSON:' . wp_json_encode( get_post_status( ${ Number(
			id
		) } ) );`
	);

/** Delete attachments for good. */
const deleteAttachments = ( ids ) =>
	evalJson(
		`foreach ( array( ${ ids
			.map( Number )
			.join(
				', '
			) } ) as $id ) { wp_delete_attachment( $id, true ); } echo 'JSON:true';`
	);

/**
 * Run the promotional reader as a user.
 *
 * @param {number[]} ids    Profile IDs.
 * @param {number}   userId Current user ID (0 for anonymous).
 * @return {Promise<Object>} The result, or `{ error, data }`.
 */
const readPromotional = ( ids, userId = 1 ) =>
	evalJson(
		`wp_set_current_user( ${ Number(
			userId
		) } ); $r = \\FairEventsExperimental\\Services\\PromotionalTeamProfiles::read( array( ${ ids
			.map( ( id ) => JSON.stringify( id ) )
			.join(
				', '
			) } ) ); echo 'JSON:' . wp_json_encode( is_wp_error( $r ) ? array( 'error' => $r->get_error_code(), 'data' => $r->get_error_data() ) : $r );`
	);

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
	const attachmentIds = [];
	const attachment = async ( mime ) => {
		const id = await createAttachment( mime );
		attachmentIds.push( id );
		return id;
	};

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
		if ( attachmentIds.length ) {
			await deleteAttachments( attachmentIds );
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

	test( 'stores, validates and clears the website, bio and portrait', async () => {
		const portrait = await attachment();
		const member = await createOk( {
			name: 'Lia',
			instagram: ' @lia.moves ',
			website_url: 'https://lia.example.com/about',
			bio: 'Teacher.\r\n\r\nDancer.',
			portrait_attachment_id: portrait,
		} );
		expect( member ).toMatchObject( {
			instagram: '@lia.moves',
			website_url: 'https://lia.example.com/about',
			bio: 'Teacher.\n\nDancer.',
			portrait_attachment_id: portrait,
		} );

		const minimal = await createOk( { name: 'Noor' } );
		expect( minimal ).toMatchObject( {
			website_url: '',
			bio: '',
			portrait_attachment_id: null,
		} );

		const pdf = await attachment( 'application/pdf' );
		const trashed = await attachment();
		await setAttachmentStatus( trashed, 'trash' );
		const rejected = await create( {
			name: 'Bad',
			website_url: 'lia.example.com',
			instagram: 'lia moves',
			portrait_attachment_id: pdf,
		} );
		expect( rejected.status() ).toBe( 400 );
		expect(
			Object.keys( ( await rejected.json() ).data.params ).sort()
		).toEqual( [ 'instagram', 'portrait_attachment_id', 'website_url' ] );
		for ( const data of [
			{ website_url: 'ftp://lia.example.com' },
			{ website_url: 'javascript:alert(1)' },
			{ portrait_attachment_id: 999999999 },
			{ portrait_attachment_id: trashed },
			{ instagram: '@' + 'a'.repeat( 31 ) },
		] ) {
			const res = await create( { name: 'Bad', ...data } );
			expect( res.status(), JSON.stringify( data ) ).toBe( 400 );
		}

		const cleared = await api.put( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
			data: { website_url: '', bio: '', portrait_attachment_id: null },
		} );
		expect( cleared.status() ).toBe( 200 );
		expect( await cleared.json() ).toMatchObject( {
			name: 'Lia',
			instagram: '@lia.moves',
			website_url: '',
			bio: '',
			portrait_attachment_id: null,
		} );
		// Detaching keeps the image in the Media Library (an unattached
		// attachment reports `publish`; a deleted one `false`).
		expect( await setAttachmentStatus( portrait, 'inherit' ) ).toBe(
			'publish'
		);

		// An older invalid handle doesn't block unrelated edits, but a new
		// invalid one is rejected.
		await evalJson(
			`global $wpdb; $wpdb->update( $wpdb->prefix . 'fair_events_team_members', array( 'instagram' => 'lia moves' ), array( 'id' => ${ member.id } ) ); echo 'JSON:true';`
		);
		const unrelated = await api.put( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
			data: { name: 'Lia', instagram: 'lia moves', surname: 'Sol' },
		} );
		expect( unrelated.status() ).toBe( 200 );
		expect( ( await unrelated.json() ).instagram ).toBe( 'lia moves' );
		const changed = await api.put( `${ PATH }/${ member.id }`, {
			headers: adminHeaders,
			data: { instagram: 'lia still moves' },
		} );
		expect( changed.status() ).toBe( 400 );
	} );

	test( 'the promotional read returns only the v1 allowlist and resolves portraits when read', async () => {
		const shared = await attachment();
		const trashed = await attachment();
		const deleted = await createAttachment();
		const solo = await createOk( {
			name: ' Solo ',
			instagram: '@solo.dj',
			email: PRIVATE_EMAIL,
			phone: PRIVATE_PHONE,
			facebook_url: 'https://www.facebook.com/solo',
			gender: 'female',
			website_url: 'https://solo.example.com',
			bio: 'Line one.\nLine two.',
			portrait_attachment_id: shared,
		} );
		const anaOne = await createOk( {
			name: 'Ana',
			surname: 'Ruiz',
			portrait_attachment_id: shared,
		} );
		const anaTwo = await createOk( {
			name: 'Ana',
			surname: ' Ruiz ',
			portrait_attachment_id: trashed,
		} );
		const gone = await createOk( {
			name: 'Gone',
			portrait_attachment_id: deleted,
		} );
		await setAttachmentStatus( trashed, 'trash' );
		await deleteAttachments( [ deleted ] );
		await evalJson(
			`global $wpdb; $wpdb->update( $wpdb->prefix . 'fair_events_team_members', array( 'instagram' => 'not valid' ), array( 'id' => ${ gone.id } ) ); echo 'JSON:true';`
		);

		const ids = [ gone.id, anaTwo.id, solo.id, anaOne.id, solo.id ];
		const result = await readPromotional( ids );
		expect( Object.keys( result ).sort() ).toEqual( [
			'members',
			'portraits',
		] );
		expect( result.members ).toEqual( [
			{
				id: `team-member:${ solo.id }`,
				sourceId: solo.id,
				displayName: 'Solo',
				instagramHandle: 'solo.dj',
				websiteUrl: 'https://solo.example.com',
				bio: 'Line one.\nLine two.',
				portraitMediaId: `media:${ shared }`,
			},
			{
				id: `team-member:${ anaOne.id }`,
				sourceId: anaOne.id,
				displayName: 'Ana Ruiz',
				instagramHandle: null,
				websiteUrl: null,
				bio: null,
				portraitMediaId: `media:${ shared }`,
			},
			{
				id: `team-member:${ anaTwo.id }`,
				sourceId: anaTwo.id,
				displayName: 'Ana Ruiz',
				instagramHandle: null,
				websiteUrl: null,
				bio: null,
				portraitMediaId: null,
			},
			{
				id: `team-member:${ gone.id }`,
				sourceId: gone.id,
				displayName: 'Gone',
				instagramHandle: null,
				websiteUrl: null,
				bio: null,
				portraitMediaId: null,
			},
		] );
		expect( Object.keys( result.portraits ) ).toEqual( [
			String( shared ),
		] );
		expect( result.portraits[ shared ] ).toMatchObject( {
			ok: true,
			width: 400,
			height: 500,
		} );
		const text = JSON.stringify( result );
		for ( const secret of [
			PRIVATE_EMAIL,
			PRIVATE_PHONE,
			'facebook.com/solo',
			'female',
			'event_count',
		] ) {
			expect( text ).not.toContain( secret );
		}

		// A restored portrait comes back on the next read.
		await setAttachmentStatus( trashed, 'inherit' );
		const restored = await readPromotional( [ anaTwo.id ] );
		expect( restored.members[ 0 ].portraitMediaId ).toBe(
			`media:${ trashed }`
		);
	} );

	test( 'the promotional read tells disabled, denied, missing and empty apart', async () => {
		const member = await createOk( {
			name: 'Kai',
			website_url: 'https://kai.example.com',
		} );

		expect( await readPromotional( [] ) ).toEqual( {
			members: [],
			portraits: [],
		} );
		expect( await readPromotional( [ member.id ], 0 ) ).toMatchObject( {
			error: 'rest_forbidden',
			data: { status: 401 },
		} );
		const subscriber = await evalJson(
			`$id = wp_insert_user( array( 'user_login' => 'team-2421-' . wp_generate_password( 6, false ), 'user_pass' => wp_generate_password(), 'role' => 'subscriber' ) ); wp_set_current_user( $id ); $r = \\FairEventsExperimental\\Services\\PromotionalTeamProfiles::read( array( ${ member.id } ) ); require_once ABSPATH . 'wp-admin/includes/user.php'; wp_delete_user( $id ); echo 'JSON:' . wp_json_encode( array( 'error' => $r->get_error_code(), 'data' => $r->get_error_data() ) );`
		);
		expect( subscriber ).toMatchObject( {
			error: 'rest_forbidden',
			data: { status: 403 },
		} );
		expect(
			( await readPromotional( [ member.id ], editorId ) ).members
		).toHaveLength( 1 );

		expect(
			await readPromotional( [ member.id, 999999999 ] )
		).toMatchObject( {
			error: 'fair_events_team_member_missing',
			data: { status: 500, member_ids: [ 999999999 ] },
		} );
		expect( await readPromotional( [ 0 ] ) ).toMatchObject( {
			error: 'fair_events_team_member_missing',
		} );

		await setBundle( false );
		try {
			expect( await readPromotional( [ member.id ] ) ).toMatchObject( {
				error: 'fair_events_team_directory_disabled',
				data: { status: 409 },
			} );
		} finally {
			await setBundle( true );
		}
		expect(
			( await readPromotional( [ member.id ] ) ).members[ 0 ]
		).toMatchObject( {
			sourceId: member.id,
			websiteUrl: 'https://kai.example.com',
		} );
	} );
} );
