/**
 * Playwright API tests for ordered contributors and roles (#2422): the
 * upgrade of #2394 memberships, role-bearing event assignments with
 * duplicates refused, ordering that survives a reload, programme item
 * contributors and the deletion protection they give a profile, a weekly
 * series shared by its occurrences (the Ana/Bea example, with campaign
 * reads for two occurrences), independent copies, cleanup and copying while
 * the `team-members` bundle is off, and the campaign read's unavailable,
 * empty and failed states.
 *
 * The suite removes the events, profiles and user it creates.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const MEMBERS_PATH = '/wp-json/fair-events/v1/team-members';
const EVENT_DATES_PATH = '/wp-json/fair-events/v1/event-dates';
const FEATURES_OPTION = 'fair_events_experimental_features';
const EDITOR_PASSWORD = 'Test-password-2422!';

const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminHeaders = basic( ADMIN_USER, ADMIN_PASSWORD );

const eventPath = ( id ) => `${ EVENT_DATES_PATH }/${ id }`;

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

const setBundle = ( enabled ) =>
	wp(
		'option',
		'update',
		FEATURES_OPTION,
		JSON.stringify( { 'team-members': enabled } ),
		'--format=json'
	);

/** The campaign contributor read for an occurrence, as the producer gets it. */
const campaignRead = ( id, setup = '' ) =>
	evalJson( `
		${ setup }
		$read = apply_filters( 'fair_events_campaign_contributors', null, ${ Number(
			id
		) } );
		echo 'JSON:' . wp_json_encode( is_wp_error( $read ) ? array( 'error' => $read->get_error_code() ) : array( 'read' => $read ) );
	` );

/** Stored assignment rows of an owner, in their order per target. */
const storedRows = ( ownerId ) =>
	evalJson(
		`global $wpdb; echo 'JSON:' . wp_json_encode( $wpdb->get_results( $wpdb->prepare( 'SELECT id, schedule_item_id, member_id, role FROM %i WHERE owner_event_date_id = %d ORDER BY schedule_item_id, position, id', $wpdb->prefix . 'fair_events_team_memberships', ${ Number(
			ownerId
		) } ), ARRAY_A ) );`
	);

test.describe( 'Event contributors', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let editorId;
	let editorHeaders;
	const memberIds = [];
	const eventDateIds = [];

	const createMember = async ( name, surname = '' ) => {
		const res = await api.post( MEMBERS_PATH, {
			headers: adminHeaders,
			data: { name, surname },
		} );
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 201 );
		memberIds.push( body.id );
		return body;
	};

	const call = async ( method, path, data, headers = adminHeaders ) => {
		const res = await api[ method ]( path, { headers, data } );
		return { status: res.status(), body: await res.json() };
	};

	const readTeam = ( id ) =>
		call( 'get', `${ eventPath( id ) }/team-members` );
	const assign = ( id, memberId, role ) =>
		call( 'post', `${ eventPath( id ) }/team-assignments`, {
			member_id: memberId,
			role,
		} );
	const unassign = ( id, assignmentId ) =>
		call(
			'delete',
			`${ eventPath( id ) }/team-assignments/${ assignmentId }`
		);
	const reorder = ( id, ids ) =>
		call( 'put', `${ eventPath( id ) }/team-assignments/order`, {
			assignment_ids: ids,
		} );
	const readProgramme = ( id ) =>
		call( 'get', `${ eventPath( id ) }/schedule-contributors` );
	const itemPath = ( id, itemId ) =>
		`${ eventPath( id ) }/schedule-items/${ itemId }/contributors`;
	const assignItem = ( id, itemId, memberId, role ) =>
		call( 'post', itemPath( id, itemId ), { member_id: memberId, role } );
	const unassignItem = ( id, itemId, assignmentId ) =>
		call( 'delete', `${ itemPath( id, itemId ) }/${ assignmentId }` );

	/** `[ memberId, role ]` pairs of a list of assignments. */
	const pairs = ( assignments ) =>
		assignments.map( ( a ) => [ a.member_id, a.role ] );
	const itemAssignments = ( programme, itemId ) =>
		programme.items.find( ( item ) => item.schedule_item_id === itemId )
			.assignments;

	/**
	 * Create an event date with a schedule: a workshop linked to a ticket
	 * option and a standalone item.
	 *
	 * @param {Object} options
	 * @param {string} [options.rrule]     Recurrence rule for a series.
	 * @param {string} [options.startDate] First date.
	 * @return {Promise<Object>} `{ id, occurrenceIds, workshopId, breakId }`.
	 */
	const createEvent = async ( { rrule, startDate = '2035-09-04' } = {} ) => {
		const created = await call( 'post', EVENT_DATES_PATH, {
			title: `Contributors ${ Date.now() } ${ Math.random() }`,
			start_date: startDate,
			start_time: '18:00:00',
			end_date: startDate,
			end_time: '21:00:00',
			...( rrule ? { rrule } : {} ),
		} );
		expect( created.status, JSON.stringify( created.body ) ).toBe( 201 );
		const id = created.body.id;
		const occurrenceIds = ( created.body.generated_occurrences || [] ).map(
			( o ) => o.id
		);
		eventDateIds.push( id, ...occurrenceIds );

		const tickets = await call( 'put', `${ eventPath( id ) }/tickets`, {
			capacity: null,
			ticket_types: [
				{
					name: 'Regular',
					capacity: null,
					minimum_activities: 0,
					maximum_activities: null,
					activities_enabled: true,
					disable_at: null,
					recurrence_scope: 'single_instance',
					minimum_instances: 1,
					group_ids: [],
				},
			],
			sale_periods: [
				{
					name: 'Always',
					sale_start: '2020-01-01 00:00:00',
					sale_end: '2099-01-01 00:00:00',
				},
			],
			prices: [
				{ ticket_type_index: 0, sale_period_index: 0, price: 0 },
			],
			options: [ { name: 'Salsa workshop', price: 0, capacity: null } ],
			settings: { schedule_enabled: true },
		} );
		expect( tickets.status, JSON.stringify( tickets.body ) ).toBe( 200 );

		const schedule = await call( 'put', `${ eventPath( id ) }/schedule`, {
			items: [
				{
					ticket_option_id: tickets.body.options[ 0 ].id,
					bookable: true,
					start_datetime: `${ startDate } 18:00:00`,
					end_datetime: `${ startDate } 19:30:00`,
					description: '',
					location: 'Studio A',
				},
				{
					ticket_option_id: null,
					bookable: false,
					title: 'Social dancing',
					start_datetime: `${ startDate } 19:30:00`,
					end_datetime: `${ startDate } 21:00:00`,
					description: '',
					location: '',
				},
			],
		} );
		expect( schedule.status, JSON.stringify( schedule.body ) ).toBe( 200 );
		const [ workshop, social ] = schedule.body.items;

		return {
			id,
			occurrenceIds,
			workshopId: workshop.id,
			breakId: social.id,
			schedule: schedule.body.items,
		};
	};

	/** Copy an event with Fair Events' copy service; returns the copy's event date ID or the error. */
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
			$copy = ( new \\FairEvents\\Services\\EventCopyService() )->copy( $source, 'Contributors copy ' . wp_generate_password( 6, false ), array( 'start_date' => '2036-02-05', 'end_date' => '2036-02-05', 'start_time' => '18:00:00', 'end_time' => '21:00:00' ) );
			echo 'JSON:' . wp_json_encode( is_wp_error( $copy ) ? array( 'error' => $copy->get_error_code() ) : $copy );
		` );
		if ( result.event_date_id ) {
			eventDateIds.push( result.event_date_id );
		}
		return result;
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		await setBundle( true );

		const login = `contributors-${ Date.now() }`;
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
			await api.delete( eventPath( id ), { headers: adminHeaders } );
		}
		for ( const id of memberIds ) {
			await api.delete( `${ MEMBERS_PATH }/${ id }`, {
				headers: adminHeaders,
			} );
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

	test( 'upgrading #2394 memberships keeps their IDs and visible order', async () => {
		// Rebuild a version 1 table on a throwaway prefix, then upgrade it.
		const result = await evalJson( `
			global $wpdb;
			$real   = $wpdb->prefix;
			$wpdb->prefix = $real . 'up2422_';
			$m      = \\FairEventsExperimental\\Models\\TeamMemberRepository::members_table();
			$ms     = \\FairEventsExperimental\\Models\\TeamMemberRepository::memberships_table();
			if ( 0 !== strpos( $ms, $real . 'up2422_' ) ) { $wpdb->prefix = $real; echo 'JSON:{"error":"prefix"}'; return; }
			$wpdb->query( "DROP TABLE IF EXISTS {$m}, {$ms}" );
			$wpdb->query( "CREATE TABLE {$m} ( id bigint(20) unsigned NOT NULL AUTO_INCREMENT, name varchar(191) NOT NULL, surname varchar(191) NOT NULL DEFAULT '', instagram varchar(191) NOT NULL DEFAULT '', email varchar(254) NOT NULL DEFAULT '', facebook_url varchar(500) NOT NULL DEFAULT '', phone varchar(64) NOT NULL DEFAULT '', gender varchar(16) DEFAULT NULL, created_at datetime NOT NULL, updated_at datetime NOT NULL, PRIMARY KEY (id) )" );
			$wpdb->query( "CREATE TABLE {$ms} ( id bigint(20) unsigned NOT NULL AUTO_INCREMENT, owner_event_date_id bigint(20) unsigned NOT NULL, member_id bigint(20) unsigned NOT NULL, created_at datetime NOT NULL, PRIMARY KEY (id), UNIQUE KEY owner_member (owner_event_date_id,member_id), KEY member_id (member_id) )" );
			$now = current_time( 'mysql', true );
			foreach ( array( 1 => 'Zoe', 2 => 'Ana', 3 => 'Marek' ) as $id => $name ) {
				$wpdb->insert( $m, array( 'id' => $id, 'name' => $name, 'created_at' => $now, 'updated_at' => $now ) );
			}
			foreach ( array( array( 41, 900, 1 ), array( 42, 900, 2 ), array( 43, 900, 3 ), array( 44, 901, 1 ) ) as $row ) {
				$wpdb->insert( $ms, array( 'id' => $row[0], 'owner_event_date_id' => $row[1], 'member_id' => $row[2], 'created_at' => $now ) );
			}
			$saved = get_option( \\FairEventsExperimental\\Models\\TeamMemberRepository::DB_VERSION_OPTION );
			update_option( \\FairEventsExperimental\\Models\\TeamMemberRepository::DB_VERSION_OPTION, '1' );
			\\FairEventsExperimental\\Models\\TeamMemberRepository::maybe_install();
			$version = get_option( \\FairEventsExperimental\\Models\\TeamMemberRepository::DB_VERSION_OPTION );
			$repo    = new \\FairEventsExperimental\\Models\\TeamMemberRepository();
			$before  = $repo->assignments_of( 900 );
			$added   = $repo->add_assignment( 900, 0, 2, 'teacher' );
			$again   = $repo->add_assignment( 900, 0, 2, 'teacher' );
			$after   = $repo->assignments_of( 900 );
			$wpdb->query( "DROP TABLE IF EXISTS {$m}, {$ms}" );
			$wpdb->prefix = $real;
			update_option( \\FairEventsExperimental\\Models\\TeamMemberRepository::DB_VERSION_OPTION, $saved );
			echo 'JSON:' . wp_json_encode( compact( 'version', 'before', 'added', 'again', 'after' ) );
		` );

		expect( result.version ).toBe( '3' );
		// Kept IDs, numbered in the order the event showed them: by name.
		expect(
			result.before.map( ( a ) => [ a.id, a.member_id, a.role ] )
		).toEqual( [
			[ 42, 2, null ],
			[ 43, 3, null ],
			[ 41, 1, null ],
		] );
		// The role-less membership does not block a role for the same person.
		expect( result.added.result ).toBe( 'created' );
		expect( result.again.result ).toBe( 'exists' );
		expect( result.after.map( ( a ) => [ a.member_id, a.role ] ) ).toEqual(
			[
				[ 2, null ],
				[ 3, null ],
				[ 1, null ],
				[ 2, 'teacher' ],
			]
		);
	} );

	test( 'every new route is restricted to administrators', async () => {
		const ana = await createMember( 'Guard', 'Ana' );
		const event = await createEvent();
		const anon = await request.newContext( { baseURL: BASE_URL } );
		const calls = [
			[ 'post', `${ eventPath( event.id ) }/team-assignments` ],
			[ 'put', `${ eventPath( event.id ) }/team-assignments/order` ],
			[ 'delete', `${ eventPath( event.id ) }/team-assignments/1` ],
			[ 'get', `${ eventPath( event.id ) }/schedule-contributors` ],
			[ 'post', itemPath( event.id, event.workshopId ) ],
			[ 'put', `${ itemPath( event.id, event.workshopId ) }/order` ],
			[ 'delete', `${ itemPath( event.id, event.workshopId ) }/1` ],
		];
		const data = { member_id: ana.id, role: 'teacher', assignment_ids: [] };

		for ( const [ method, path ] of calls ) {
			const anonymous = await anon[ method ]( path, { data } );
			expect( anonymous.status(), `${ method } ${ path }` ).toBe( 401 );
			const editor = await api[ method ]( path, {
				headers: editorHeaders,
				data,
			} );
			expect( editor.status(), `${ method } ${ path }` ).toBe( 403 );
		}
		await anon.dispose();
		expect( await storedRows( event.id ) ).toEqual( [] );
	} );

	test( 'one person holds two roles, a repeated role is refused, and unlinking one role keeps the rest', async () => {
		const ana = await createMember( 'Roles', 'Ana' );
		const bea = await createMember( 'Roles', 'Bea' );
		const event = await createEvent();
		const other = await createEvent();

		// A #2394 membership first, then distinct roles for the same person.
		expect(
			(
				await call( 'post', `${ eventPath( event.id ) }/team-members`, {
					member_id: ana.id,
				} )
			).status
		).toBe( 201 );
		expect( ( await assign( event.id, ana.id, 'teacher' ) ).status ).toBe(
			201
		);
		expect( ( await assign( event.id, ana.id, 'organizer' ) ).status ).toBe(
			201
		);
		const duplicate = await assign( event.id, ana.id, 'teacher' );
		expect( duplicate.status ).toBe( 409 );
		expect( duplicate.body.code ).toBe( 'rest_team_assignment_exists' );
		// Another target is independent.
		expect( ( await assign( other.id, ana.id, 'teacher' ) ).status ).toBe(
			201
		);
		expect( ( await assign( event.id, bea.id, 'teacher' ) ).status ).toBe(
			201
		);

		for ( const role of [
			'Teacher',
			'lead teacher',
			'1st',
			'',
			'a'.repeat( 65 ),
		] ) {
			const invalid = await assign( event.id, bea.id, role );
			expect( invalid.status, role ).toBe( 400 );
		}

		const team = ( await readTeam( event.id ) ).body;
		expect( pairs( team.assignments ) ).toEqual( [
			[ ana.id, null ],
			[ ana.id, 'teacher' ],
			[ ana.id, 'organizer' ],
			[ bea.id, 'teacher' ],
		] );
		expect( team.members.map( ( m ) => m.id ) ).toEqual( [
			ana.id,
			bea.id,
		] );

		// Unlink Ana's teacher role by ID: her other roles stay.
		const teacher = team.assignments[ 1 ];
		const removed = await unassign( event.id, teacher.id );
		expect( removed.status ).toBe( 200 );
		expect( pairs( removed.body.assignments ) ).toEqual( [
			[ ana.id, null ],
			[ ana.id, 'organizer' ],
			[ bea.id, 'teacher' ],
		] );
		// The member route removes only the role-less membership.
		const legacy = await call(
			'delete',
			`${ eventPath( event.id ) }/team-members/${ ana.id }`
		);
		expect( pairs( legacy.body.assignments ) ).toEqual( [
			[ ana.id, 'organizer' ],
			[ bea.id, 'teacher' ],
		] );
		expect(
			pairs( ( await readTeam( other.id ) ).body.assignments )
		).toEqual( [ [ ana.id, 'teacher' ] ] );
	} );

	test( 'ordering survives a reload, and a stale order is refused', async () => {
		const ana = await createMember( 'Order', 'Ana' );
		const bea = await createMember( 'Order', 'Bea' );
		const cid = await createMember( 'Order', 'Cid' );
		const event = await createEvent();
		for ( const member of [ ana, bea, cid ] ) {
			await assign( event.id, member.id, 'teacher' );
		}
		const ids = ( await readTeam( event.id ) ).body.assignments.map(
			( a ) => a.id
		);

		const moved = await reorder( event.id, [
			ids[ 2 ],
			ids[ 0 ],
			ids[ 1 ],
		] );
		expect( moved.status ).toBe( 200 );
		const reloaded = ( await readTeam( event.id ) ).body;
		expect( reloaded.assignments.map( ( a ) => a.member_id ) ).toEqual( [
			cid.id,
			ana.id,
			bea.id,
		] );

		// Missing, foreign or repeated IDs change nothing.
		for ( const order of [
			[ ids[ 0 ], ids[ 1 ] ],
			[ ids[ 0 ], ids[ 1 ], ids[ 2 ], 999999999 ],
		] ) {
			const stale = await reorder( event.id, order );
			expect( stale.status ).toBe( 409 );
			expect( stale.body.code ).toBe( 'rest_team_order_stale' );
		}
		expect(
			( await reorder( event.id, [ ids[ 0 ], ids[ 0 ], ids[ 1 ] ] ) )
				.status
		).toBe( 400 );
		// An addition lands at the end of the saved order.
		await assign( event.id, ana.id, 'organizer' );
		expect(
			pairs( ( await readTeam( event.id ) ).body.assignments )
		).toEqual( [
			[ cid.id, 'teacher' ],
			[ ana.id, 'teacher' ],
			[ bea.id, 'teacher' ],
			[ ana.id, 'organizer' ],
		] );
	} );

	test( 'a programme item reference protects the profile until the assignment or the item is removed', async () => {
		const fresh = await createMember( 'Programme', 'Only' );
		const event = await createEvent();

		const added = await assignItem(
			event.id,
			event.breakId,
			fresh.id,
			'host'
		);
		expect( added.status, JSON.stringify( added.body ) ).toBe( 201 );
		expect( pairs( itemAssignments( added.body, event.breakId ) ) ).toEqual(
			[ [ fresh.id, 'host' ] ]
		);
		expect(
			( await assignItem( event.id, event.breakId, fresh.id, 'host' ) )
				.status
		).toBe( 409 );
		expect(
			( await assignItem( event.id, 999999999, fresh.id, 'host' ) ).status
		).toBe( 404 );

		const blocked = await call(
			'delete',
			`${ MEMBERS_PATH }/${ fresh.id }`
		);
		expect( blocked.status ).toBe( 409 );
		expect( blocked.body.code ).toBe( 'rest_team_member_linked' );
		expect( blocked.body.data.events ).toEqual( [
			expect.objectContaining( {
				event_date_id: event.id,
				programme_items: [
					{
						schedule_item_id: event.breakId,
						title: 'Social dancing',
					},
				],
			} ),
		] );

		// Unlinking the assignment releases the profile.
		const assignmentId = itemAssignments( added.body, event.breakId )[ 0 ]
			.id;
		await unassignItem( event.id, event.breakId, assignmentId );
		await assignItem( event.id, event.workshopId, fresh.id, 'teacher' );

		// Removing the item from the schedule removes its contributors too.
		const kept = event.schedule.filter(
			( item ) => item.id !== event.workshopId
		);
		const saved = await call(
			'put',
			`${ eventPath( event.id ) }/schedule`,
			{
				items: kept.map( ( item ) => ( {
					...item,
					ticket_option_id: null,
				} ) ),
			}
		);
		expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );
		expect( await storedRows( event.id ) ).toEqual( [] );

		const deleted = await call(
			'delete',
			`${ MEMBERS_PATH }/${ fresh.id }`
		);
		expect( deleted.status ).toBe( 200 );
		memberIds.splice( memberIds.indexOf( fresh.id ), 1 );
	} );

	test( 'the Ana/Bea series: occurrences share the series’ assignments, reject writes, and campaign reads follow a replacement', async () => {
		const ana = await createMember( 'Ana', 'Series' );
		const bea = await createMember( 'Bea', 'Series' );
		const lead = await createMember( 'Lead', 'Series' );
		const series = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=4',
			startDate: '2026-11-10',
		} );
		const [ past, , future ] = series.occurrenceIds;
		expect( future ).toBeTruthy();

		await assign( series.id, lead.id, 'organizer' );
		await assign( series.id, ana.id, 'teacher' );
		await assignItem( series.id, series.workshopId, ana.id, 'teacher' );
		await assignItem( series.id, series.breakId, lead.id, 'host' );

		// A copy made now keeps Ana after the series changes.
		const copy = await copyEvent( series.id );
		expect( copy.event_date_id, JSON.stringify( copy ) ).toBeTruthy();

		// Occurrence edits are unavailable and change nothing.
		for ( const occurrence of [ past, future ] ) {
			const team = await assign( occurrence, bea.id, 'teacher' );
			expect( team.status ).toBe( 409 );
			expect( team.body.code ).toBe( 'rest_team_managed_on_series' );
			expect( team.body.data.series_event_date_id ).toBe( series.id );
			const item = await assignItem(
				occurrence,
				series.workshopId,
				bea.id,
				'teacher'
			);
			expect( item.status ).toBe( 409 );
			expect( item.body.code ).toBe( 'rest_schedule_managed_on_series' );
			const order = await reorder( occurrence, [] );
			expect( order.status ).toBe( 409 );
		}
		expect( await storedRows( past ) ).toEqual( [] );

		// Replace Ana with Bea on the series: add Bea, move her to Ana's
		// place, remove Ana.
		const replace = async ( list, add, remove, orderPath ) => {
			const added = await add();
			expect( added.status ).toBe( 201 );
			const current = list( added.body );
			const anaRow = current.find( ( a ) => a.member_id === ana.id );
			const beaRow = current.find( ( a ) => a.member_id === bea.id );
			const order = current.map( ( a ) => a.id );
			order.splice( order.indexOf( beaRow.id ), 1 );
			order.splice( order.indexOf( anaRow.id ), 0, beaRow.id );
			expect(
				(
					await call( 'put', orderPath, {
						assignment_ids: order,
					} )
				).status
			).toBe( 200 );
			expect( ( await remove( anaRow.id ) ).status ).toBe( 200 );
		};
		await replace(
			( body ) => body.assignments,
			() => assign( series.id, bea.id, 'teacher' ),
			( id ) => unassign( series.id, id ),
			`${ eventPath( series.id ) }/team-assignments/order`
		);
		await replace(
			( body ) => itemAssignments( body, series.workshopId ),
			() => assignItem( series.id, series.workshopId, bea.id, 'teacher' ),
			( id ) => unassignItem( series.id, series.workshopId, id ),
			`${ itemPath( series.id, series.workshopId ) }/order`
		);

		// Past and future dates read the replacement, in order.
		for ( const occurrence of [ past, future ] ) {
			const team = ( await readTeam( occurrence ) ).body;
			expect( team.series_event_date_id ).toBe( series.id );
			expect( pairs( team.assignments ) ).toEqual( [
				[ lead.id, 'organizer' ],
				[ bea.id, 'teacher' ],
			] );
			const programme = ( await readProgramme( occurrence ) ).body;
			expect( programme.series_event_date_id ).toBe( series.id );
			expect(
				pairs( itemAssignments( programme, series.workshopId ) )
			).toEqual( [ [ bea.id, 'teacher' ] ] );
		}

		const expected = {
			eventContributors: [
				{ memberId: `team-member:${ lead.id }`, role: 'organizer' },
				{ memberId: `team-member:${ bea.id }`, role: 'teacher' },
			],
			items: [
				{
					id: `schedule-item:${ series.workshopId }`,
					contributors: [
						{
							memberId: `team-member:${ bea.id }`,
							role: 'teacher',
						},
					],
				},
				{
					id: `schedule-item:${ series.breakId }`,
					contributors: [
						{ memberId: `team-member:${ lead.id }`, role: 'host' },
					],
				},
			],
			memberIds: [ bea.id, lead.id ].sort( ( a, b ) => a - b ),
		};
		for ( const occurrence of [ past, future ] ) {
			expect( await campaignRead( occurrence ) ).toEqual( {
				read: expected,
			} );
		}

		// The independent copy kept Ana and the original order on its own items.
		const copyProgramme = ( await readProgramme( copy.event_date_id ) )
			.body;
		expect( copyProgramme.series_event_date_id ).toBeNull();
		const copyItemIds = copyProgramme.items.map(
			( item ) => item.schedule_item_id
		);
		expect( copyItemIds ).not.toContain( series.workshopId );
		expect(
			copyProgramme.items.map( ( item ) => pairs( item.assignments ) )
		).toEqual( [ [ [ ana.id, 'teacher' ] ], [ [ lead.id, 'host' ] ] ] );
		expect(
			pairs( ( await readTeam( copy.event_date_id ) ).body.assignments )
		).toEqual( [
			[ lead.id, 'organizer' ],
			[ ana.id, 'teacher' ],
		] );
	} );

	test( 'a failed copy leaves no assignments on the destination', async () => {
		const member = await createMember( 'Copy', 'Fails' );
		const source = await createEvent();
		await assign( source.id, member.id, 'teacher' );
		await assignItem( source.id, source.workshopId, member.id, 'teacher' );
		const countRows = () =>
			evalJson(
				`global $wpdb; echo 'JSON:' . (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i', $wpdb->prefix . 'fair_events_team_memberships' ) );`
			);

		const before = await countRows();
		const failed = await copyEvent( source.id, 'extension_copying' );
		expect( failed.error ).toBe( 'event_copy_failed' );
		expect( await countRows() ).toBe( before );
	} );

	test( 'with the bundle off, item removal and copies still keep assignments in step', async () => {
		const ana = await createMember( 'Off', 'Ana' );
		const bea = await createMember( 'Off', 'Bea' );
		const source = await createEvent();
		await assign( source.id, bea.id, 'organizer' );
		await assign( source.id, ana.id, 'teacher' );
		await assignItem( source.id, source.workshopId, bea.id, 'teacher' );
		await assignItem( source.id, source.workshopId, ana.id, 'teacher' );
		await assignItem( source.id, source.breakId, ana.id, 'host' );

		let copy;
		await setBundle( false );
		try {
			expect( await campaignRead( source.id ) ).toEqual( { read: null } );

			const kept = source.schedule.filter(
				( item ) => item.id !== source.breakId
			);
			const saved = await call(
				'put',
				`${ eventPath( source.id ) }/schedule`,
				{ items: kept }
			);
			expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );

			copy = await copyEvent( source.id );
			expect( copy.event_date_id, JSON.stringify( copy ) ).toBeTruthy();
		} finally {
			await setBundle( true );
		}

		expect(
			itemAssignments(
				( await readProgramme( source.id ) ).body,
				source.workshopId
			).length
		).toBe( 2 );
		expect(
			( await storedRows( source.id ) ).filter(
				( row ) => Number( row.schedule_item_id ) === source.breakId
			)
		).toEqual( [] );

		const copied = ( await readProgramme( copy.event_date_id ) ).body;
		expect(
			copied.items.map( ( item ) => pairs( item.assignments ) )
		).toEqual( [
			[
				[ bea.id, 'teacher' ],
				[ ana.id, 'teacher' ],
			],
		] );
		expect(
			pairs( ( await readTeam( copy.event_date_id ) ).body.assignments )
		).toEqual( [
			[ bea.id, 'organizer' ],
			[ ana.id, 'teacher' ],
		] );
	} );

	test( 'campaign reads: absent companion, empty target, legacy memberships left out, and failures surfaced', async () => {
		const legacy = await createMember( 'Campaign', 'Legacy' );
		const event = await createEvent();

		expect(
			await campaignRead(
				event.id,
				"remove_all_filters( 'fair_events_campaign_contributors' );"
			)
		).toEqual( { read: null } );

		await call( 'post', `${ eventPath( event.id ) }/team-members`, {
			member_id: legacy.id,
		} );
		expect( await campaignRead( event.id ) ).toEqual( {
			read: {
				eventContributors: [],
				items: [
					{
						id: `schedule-item:${ event.workshopId }`,
						contributors: [],
					},
					{
						id: `schedule-item:${ event.breakId }`,
						contributors: [],
					},
				],
				memberIds: [],
			},
		} );

		expect(
			await campaignRead(
				event.id,
				"add_filter( 'query', static function ( $q ) { return false !== strpos( $q, 'fair_events_team_memberships' ) ? 'SELECT broken FROM nowhere_2422' : $q; } );"
			)
		).toEqual( { error: 'fair_events_source_unavailable' } );

		// A reference to a profile that no longer exists is an error too.
		await assign( event.id, legacy.id, 'teacher' );
		expect(
			await campaignRead(
				event.id,
				`global $wpdb; $wpdb->query( 'START TRANSACTION' ); $wpdb->delete( $wpdb->prefix . 'fair_events_team_members', array( 'id' => ${ legacy.id } ) ); register_shutdown_function( static function () { global $wpdb; $wpdb->query( 'ROLLBACK' ); } );`
			)
		).toEqual( { error: 'fair_events_team_member_missing' } );
		expect(
			( await call( 'get', `${ MEMBERS_PATH }/${ legacy.id }` ) ).status
		).toBe( 200 );

		expect( await campaignRead( 999999999 ) ).toEqual( {
			error: 'rest_event_date_not_found',
		} );
	} );
} );
