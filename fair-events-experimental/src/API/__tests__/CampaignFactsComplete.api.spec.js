/**
 * Playwright API tests for GET /fair-events/v1/event-dates/{id}/campaign-facts/complete
 * (#2424): every source fact of a campaign-facts v1 snapshot, with Fair
 * Events Experimental providing contributors, promotional profiles and
 * ordered media.
 *
 * Covers a single event (resolved workshop titles, programme order,
 * standalone items, bookability independent of capacity, `languages: null`),
 * a generated occurrence (selected and owner IDs, shifted times, inherited
 * contributors, ordered and deduplicated media with association-local
 * circles), coherence under an edit committed on a second connection while
 * the read is paused, the snapshot's refusal of non-transactional tables,
 * each optional feature unavailable on its own, genuinely empty
 * collections, access, missing records, broken references, failed queries,
 * and private fields staying out.
 *
 * The suite removes the events, posts, attachments, profiles and users it
 * creates, and restores the feature setting and timezone it found.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const EVENT_DATES_PATH = '/wp-json/fair-events/v1/event-dates';
const MEMBERS_PATH = '/wp-json/fair-events/v1/team-members';
const IMAGES_BASE = '/wp-json/fair-events-experimental/v1/event-dates';
const FEATURES_OPTION = 'fair_events_experimental_features';
const USER_PASSWORD = 'Test-password-2424!';

const ROOT = new URL( '../../../../', import.meta.url );

const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminHeaders = basic( ADMIN_USER, ADMIN_PASSWORD );

const eventPath = ( id ) => `${ EVENT_DATES_PATH }/${ id }`;
const completePath = ( id ) => `${ eventPath( id ) }/campaign-facts/complete`;

/** Run WP-CLI on the tests instance without blocking the event loop. */
async function wp( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', 'wp', ...args ],
		{ cwd: ROOT, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }
	);
	return stdout;
}

/** Evaluate PHP on the tests instance and parse the JSON it echoes after `JSON:`. */
async function evalJson( php ) {
	const out = await wp( 'eval', php );
	const at = out.indexOf( 'JSON:' );
	if ( at < 0 ) {
		throw new Error( `Expected JSON output, got:\n${ out }` );
	}
	return JSON.parse(
		out
			.slice( at + 5 )
			.trim()
			.split( '\n' )[ 0 ]
	);
}

/**
 * The complete read as an administrator, in process, after some setup PHP.
 *
 * @param {number} id    Event date ID.
 * @param {string} setup PHP run first (filters, synchronization points).
 * @param {string} after PHP run after the read; may set `$extra`.
 * @return {Promise<Object>} `{ status, body, extra }`.
 */
const completeInProcess = ( id, setup = '', after = '' ) =>
	evalJson( `
		wp_set_current_user( 1 );
		$extra = null;
		${ setup }
		$response = rest_do_request( new WP_REST_Request( 'GET', '/fair-events/v1/event-dates/${ Number(
			id
		) }/campaign-facts/complete' ) );
		${ after }
		echo 'JSON:' . wp_json_encode( array( 'status' => $response->get_status(), 'body' => rest_get_server()->response_to_data( $response, false ), 'extra' => $extra ) );
	` );

/**
 * Rewrite matching queries while the read runs (broken references,
 * failures). The snapshot's table audit names every table, so it is left
 * alone.
 *
 * @param {string} needle      Text a query must contain.
 * @param {string} replacement PHP expression of the new query (`$q` is the old one).
 * @return {string} Setup PHP.
 */
const rewriteQuery = ( needle, replacement ) =>
	`add_filter( 'query', static function ( $q ) { return ( false !== strpos( $q, ${ JSON.stringify(
		needle
	) } ) && false === strpos( $q, 'information_schema' ) ) ? ${ replacement } : $q; } );`;

/** Run the event-images media fixture script and parse its result. */
async function mediaFixture( ...args ) {
	const out = await wp(
		'eval-file',
		'wp-content/mu-plugins/scripts/event-images-fixture.php',
		...args
	);
	const match = out.match( /E2E_EVENT_IMAGES:(.*)/ );
	if ( ! match ) {
		throw new Error( `Fixture ${ args.join( ' ' ) } failed: ${ out }` );
	}
	return JSON.parse( match[ 1 ] );
}

/** Run the campaign-facts fixture script (timezone) and parse its result. */
async function factsFixture( action, data ) {
	const out = await wp(
		'eval-file',
		'wp-content/mu-plugins/scripts/campaign-facts.php',
		action,
		JSON.stringify( data )
	);
	const match = out.match( /E2E_CAMPAIGN_FACTS:(\{.*\})/ );
	if ( ! match ) {
		throw new Error( `Fixture ${ action } failed: ${ out }` );
	}
	return JSON.parse( match[ 1 ] );
}

test.describe( 'Complete campaign facts', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let savedFeatures = null;
	let previousTimezone;
	const eventDateIds = [];
	const postIds = [];
	const attachmentIds = [];
	const memberIds = [];
	const userIds = [];
	const media = {};

	const call = async ( method, path, data, headers = adminHeaders ) => {
		const res = await api[ method ]( path, { headers, data } );
		return { status: res.status(), body: await res.json() };
	};

	const readComplete = async ( id, headers = adminHeaders ) => {
		const res = await api.get( completePath( id ), { headers } );
		return {
			status: res.status(),
			body: await res.json(),
			cacheControl: res.headers()[ 'cache-control' ],
		};
	};

	const setFeatures = ( features ) =>
		wp(
			'option',
			'update',
			FEATURES_OPTION,
			JSON.stringify( { ...( savedFeatures || {} ), ...features } ),
			'--format=json'
		);

	const createMember = async ( data ) => {
		const res = await call( 'post', MEMBERS_PATH, data );
		expect( res.status, JSON.stringify( res.body ) ).toBe( 201 );
		memberIds.push( res.body.id );
		return res.body;
	};

	const createUser = async ( role ) => {
		const res = await call( 'post', '/wp-json/wp/v2/users', {
			username: `cf2424_${ role }_${ Date.now() }`,
			email: `cf2424_${ role }_${ Date.now() }@example.com`,
			password: USER_PASSWORD,
			roles: [ role ],
		} );
		expect( res.status, JSON.stringify( res.body ) ).toBe( 201 );
		userIds.push( res.body.id );
		return basic( res.body.username, USER_PASSWORD );
	};

	/**
	 * A post-linked event with a ticketed workshop and a standalone item
	 * (listed first in the request but starting later), optionally a
	 * weekly series.
	 *
	 * @param {Object}  [options]
	 * @param {string}  [options.rrule]    Recurrence rule.
	 * @param {boolean} [options.schedule] Whether to add the programme.
	 * @return {Promise<Object>} `{ id, postId, occurrenceIds, optionId, workshopId, standaloneId }`.
	 */
	const createEvent = async ( { rrule, schedule = true } = {} ) => {
		const title = `Complete facts ${ Date.now() } ${ Math.random() }`;
		const post = await call( 'post', '/wp-json/wp/v2/fair_event', {
			title,
			status: 'publish',
		} );
		expect( post.status, JSON.stringify( post.body ) ).toBe( 201 );
		postIds.push( post.body.id );

		const created = await call( 'post', EVENT_DATES_PATH, {
			title,
			link_type: 'post',
			start_date: '2037-03-04',
			end_date: '2037-03-04',
			start_time: '18:00:00',
			end_time: '22:00:00',
			...( rrule ? { rrule } : {} ),
		} );
		expect( created.status, JSON.stringify( created.body ) ).toBe( 201 );
		const id = created.body.id;
		const occurrenceIds = ( created.body.generated_occurrences || [] ).map(
			( o ) => o.id
		);
		eventDateIds.push( id, ...occurrenceIds );

		const link = await call( 'put', eventPath( id ), {
			event_id: post.body.id,
		} );
		expect( link.status, JSON.stringify( link.body ) ).toBe( 200 );

		if ( ! schedule ) {
			return { id, postId: post.body.id, occurrenceIds };
		}

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
			options: [ { name: 'Acro workshop', price: 0, capacity: 1 } ],
			settings: { schedule_enabled: true },
		} );
		expect( tickets.status, JSON.stringify( tickets.body ) ).toBe( 200 );
		const optionId = tickets.body.options[ 0 ].id;

		const saved = await call( 'put', `${ eventPath( id ) }/schedule`, {
			items: [
				{
					ticket_option_id: null,
					bookable: false,
					title: '  Social dancing  ',
					start_datetime: '2037-03-04 20:00:00',
					end_datetime: '2037-03-04 22:00:00',
					description: '',
					location: '  ',
				},
				{
					ticket_option_id: optionId,
					bookable: true,
					start_datetime: '2037-03-04 18:00:00',
					end_datetime: '2037-03-04 19:30:00',
					description: 'Bring water.',
					location: 'Studio A',
				},
			],
		} );
		expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );
		const workshop = saved.body.items.find( ( i ) => i.ticket_option_id );
		const standalone = saved.body.items.find(
			( i ) => ! i.ticket_option_id
		);

		return {
			id,
			postId: post.body.id,
			occurrenceIds,
			optionId,
			workshopId: workshop.id,
			standaloneId: standalone.id,
		};
	};

	const imagesPath = ( id ) => `${ IMAGES_BASE }/${ id }/images`;
	/** Replace one image list of an event from its current revision. */
	const saveImages = async ( id, itemId, images ) => {
		const current = ( await call( 'get', imagesPath( id ) ) ).body;
		const list = itemId
			? current.scheduleItems.find( ( i ) => i.scheduleItemId === itemId )
			: current.event;
		const path = itemId
			? `${ imagesPath( id ) }/schedule-items/${ itemId }`
			: `${ imagesPath( id ) }/event`;
		const saved = await call( 'put', path, {
			revision: list.revision,
			images,
		} );
		expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );
	};

	const circle = ( image, centerX, centerY, radius ) => ( {
		attachmentId: image.id,
		focalRegion: { centerX, centerY, radius },
		sourceRevision: image.revision,
	} );

	const mediaEntry = ( image, altText = null ) => ( {
		id: `media:${ image.id }`,
		sourceId: image.id,
		sourceUrl: image.url,
		altText,
		credit: null,
		width: image.width,
		height: image.height,
	} );

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const stored = await wp(
			'option',
			'get',
			FEATURES_OPTION,
			'--format=json'
		).catch( () => '' );
		try {
			savedFeatures = JSON.parse( stored.trim().split( '\n' ).pop() );
		} catch {
			savedFeatures = null;
		}
		await setFeatures( { 'team-members': true, 'event-images': true } );
		previousTimezone = await factsFixture( 'timezone', {
			timezone_string: 'Europe/Madrid',
			gmt_offset: 0,
		} );

		for ( const [ key, width, height ] of [
			[ 'poster', '400', '100' ],
			[ 'portrait', '120', '120' ],
			[ 'stage', '200', '150' ],
		] ) {
			const image = await mediaFixture( 'png', width, height );
			attachmentIds.push( image.id );
			const described = (
				await call( 'get', `/wp-json/wp/v2/media/${ image.id }` )
			).body;
			media[ key ] = {
				...image,
				url: described.source_url,
				width: Number( width ),
				height: Number( height ),
			};
		}
		// The images read gives each attachment's current source revision.
		const probe = await createEvent( { schedule: false } );
		await saveImages(
			probe.id,
			0,
			[ media.poster, media.portrait, media.stage ].map( ( m ) => ( {
				attachmentId: m.id,
				focalRegion: null,
			} ) )
		);
		const read = ( await call( 'get', imagesPath( probe.id ) ) ).body;
		for ( const image of read.event.images ) {
			const key = Object.keys( media ).find(
				( k ) => media[ k ].id === image.attachmentId
			);
			media[ key ].revision = image.sourceRevision;
		}
	} );

	test.afterAll( async () => {
		if ( savedFeatures ) {
			await wp(
				'option',
				'update',
				FEATURES_OPTION,
				JSON.stringify( savedFeatures ),
				'--format=json'
			).catch( () => {} );
		} else {
			await wp( 'option', 'delete', FEATURES_OPTION ).catch( () => {} );
		}
		if ( previousTimezone ) {
			await factsFixture( 'timezone', previousTimezone ).catch(
				() => {}
			);
		}
		for ( const id of [ ...new Set( eventDateIds ) ].reverse() ) {
			await api.delete( eventPath( id ), { headers: adminHeaders } );
		}
		for ( const id of postIds ) {
			await api.delete( `/wp-json/wp/v2/fair_event/${ id }?force=true`, {
				headers: adminHeaders,
			} );
		}
		for ( const id of memberIds ) {
			await api.delete( `${ MEMBERS_PATH }/${ id }`, {
				headers: adminHeaders,
			} );
		}
		if ( attachmentIds.length ) {
			await mediaFixture(
				'cleanup',
				...attachmentIds.map( String )
			).catch( () => {} );
		}
		for ( const id of userIds ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ id }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'a single event: resolved titles, programme order, standalone items and bookability independent of capacity', async () => {
		const event = await createEvent();
		const ana = await createMember( {
			name: ' Ana ',
			surname: 'Ruiz',
			instagram: '@ana.dances',
			email: 'ana-2424@example.com',
			phone: '+34 600 000 000',
			gender: 'female',
			website_url: 'https://example.com/ana',
			bio: 'Teacher.\r\nDancer.',
		} );

		// The workshop is renamed in Prices after scheduling, and sold out.
		await evalJson( `
			global $wpdb;
			$wpdb->update( $wpdb->prefix . 'fair_events_ticket_options', array( 'name' => 'Acro (renamed)', 'capacity' => 0 ), array( 'id' => ${ event.optionId } ) );
			// A legacy standalone row stored as bookable still exports as not bookable.
			$wpdb->update( $wpdb->prefix . 'fair_events_schedule_items', array( 'bookable' => 1 ), array( 'id' => ${ event.standaloneId } ) );
			echo 'JSON:' . wp_json_encode( $wpdb->last_error );
		` );

		expect(
			(
				await call(
					'post',
					`${ eventPath( event.id ) }/team-assignments`,
					{
						member_id: ana.id,
						role: 'organizer',
					}
				)
			).status
		).toBe( 201 );
		expect(
			(
				await call(
					'post',
					`${ eventPath( event.id ) }/schedule-items/${
						event.workshopId
					}/contributors`,
					{ member_id: ana.id, role: 'teacher' }
				)
			).status
		).toBe( 201 );
		await saveImages( event.id, 0, [
			circle( media.stage, 0.5, 0.5, 0.25 ),
			{ attachmentId: media.poster.id, focalRegion: null },
		] );

		const { status, body, cacheControl } = await readComplete( event.id );
		expect( status, JSON.stringify( body ) ).toBe( 200 );
		expect( cacheControl ).toContain( 'no-store' );

		expect( body.eventDateId ).toBe( event.id );
		expect( body.scheduleEventDateId ).toBe( event.id );
		expect( body.event.mediaIds ).toEqual( [
			`media:${ media.stage.id }`,
			`media:${ media.poster.id }`,
		] );
		expect( body.event.focalRegions ).toEqual( {
			[ `media:${ media.stage.id }` ]: {
				centerX: 0.5,
				centerY: 0.5,
				radius: 0.25,
			},
		} );
		expect( body.schedule ).toEqual( {
			enabled: true,
			items: [
				{
					id: `schedule-item:${ event.workshopId }`,
					sourceId: event.workshopId,
					ticketOptionId: event.optionId,
					title: 'Acro (renamed)',
					description: 'Bring water.',
					startsAtLocal: '2037-03-04T18:00:00',
					endsAtLocal: '2037-03-04T19:30:00',
					location: 'Studio A',
					languages: null,
					bookable: true,
					contributors: [
						{
							memberId: `team-member:${ ana.id }`,
							role: 'teacher',
						},
					],
					mediaIds: [],
					focalRegions: {},
				},
				{
					id: `schedule-item:${ event.standaloneId }`,
					sourceId: event.standaloneId,
					ticketOptionId: null,
					title: 'Social dancing',
					description: null,
					startsAtLocal: '2037-03-04T20:00:00',
					endsAtLocal: '2037-03-04T22:00:00',
					location: null,
					languages: null,
					bookable: false,
					contributors: [],
					mediaIds: [],
					focalRegions: {},
				},
			],
		} );
		expect( body.team ).toEqual( {
			members: [
				{
					id: `team-member:${ ana.id }`,
					sourceId: ana.id,
					displayName: 'Ana Ruiz',
					instagramHandle: 'ana.dances',
					websiteUrl: 'https://example.com/ana',
					bio: 'Teacher.\nDancer.',
					portraitMediaId: null,
				},
			],
			eventContributors: [
				{ memberId: `team-member:${ ana.id }`, role: 'organizer' },
			],
		} );
		expect( body.media ).toEqual(
			[ media.poster, media.stage ]
				.sort( ( a, b ) => a.id - b.id )
				.map( ( m ) => mediaEntry( m ) )
		);

		// Private fields never leave the site.
		const raw = JSON.stringify( body );
		for ( const secret of [
			'ana-2424@example.com',
			'+34 600 000 000',
			'female',
			'gender',
			'email',
			'phone',
			'joining',
		] ) {
			expect( raw ).not.toContain( secret );
		}
	} );

	test( 'a generated occurrence: owner IDs, shifted times, inherited contributors and deduplicated media', async () => {
		const series = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=2',
		} );
		const occurrenceId = series.occurrenceIds[ 0 ];
		expect( occurrenceId ).toBeTruthy();

		const bea = await createMember( { name: 'Bea', surname: '' } );
		expect(
			(
				await call( 'put', `${ MEMBERS_PATH }/${ bea.id }`, {
					portrait_attachment_id: media.portrait.id,
				} )
			).status
		).toBe( 200 );
		const cris = await createMember( { name: 'Cris', surname: 'Ortiz' } );

		for ( const [ itemId, memberId, role ] of [
			[ series.workshopId, bea.id, 'teacher' ],
			[ series.workshopId, cris.id, 'teacher' ],
			[ series.standaloneId, bea.id, 'dj' ],
		] ) {
			expect(
				(
					await call(
						'post',
						`${ eventPath(
							series.id
						) }/schedule-items/${ itemId }/contributors`,
						{ member_id: memberId, role }
					)
				).status
			).toBe( 201 );
		}
		expect(
			(
				await call(
					'post',
					`${ eventPath( series.id ) }/team-assignments`,
					{
						member_id: cris.id,
						role: 'organizer',
					}
				)
			).status
		).toBe( 201 );

		// The portrait is also an event image and a workshop image, with a
		// different circle in each list.
		await saveImages( series.id, 0, [
			{ attachmentId: media.poster.id, focalRegion: null },
			circle( media.portrait, 0.3, 0.3, 0.2 ),
		] );
		await saveImages( series.id, series.workshopId, [
			circle( media.portrait, 0.6, 0.6, 0.3 ),
		] );

		const { status, body } = await readComplete( occurrenceId );
		expect( status, JSON.stringify( body ) ).toBe( 200 );
		expect( body.eventDateId ).toBe( occurrenceId );
		expect( body.scheduleEventDateId ).toBe( series.id );
		expect( body.event.timing.startDate ).toBe( '2037-03-11' );

		expect(
			body.schedule.items.map( ( item ) => [
				item.sourceId,
				item.startsAtLocal,
				item.endsAtLocal,
				item.contributors,
				item.mediaIds,
				item.focalRegions,
			] )
		).toEqual( [
			[
				series.workshopId,
				'2037-03-11T18:00:00',
				'2037-03-11T19:30:00',
				[
					{ memberId: `team-member:${ bea.id }`, role: 'teacher' },
					{ memberId: `team-member:${ cris.id }`, role: 'teacher' },
				],
				[ `media:${ media.portrait.id }` ],
				{
					[ `media:${ media.portrait.id }` ]: {
						centerX: 0.6,
						centerY: 0.6,
						radius: 0.3,
					},
				},
			],
			[
				series.standaloneId,
				'2037-03-11T20:00:00',
				'2037-03-11T22:00:00',
				[ { memberId: `team-member:${ bea.id }`, role: 'dj' } ],
				[],
				{},
			],
		] );
		expect( body.event.mediaIds ).toEqual( [
			`media:${ media.poster.id }`,
			`media:${ media.portrait.id }`,
		] );
		expect( body.event.focalRegions ).toEqual( {
			[ `media:${ media.portrait.id }` ]: {
				centerX: 0.3,
				centerY: 0.3,
				radius: 0.2,
			},
		} );
		expect( body.team.eventContributors ).toEqual( [
			{ memberId: `team-member:${ cris.id }`, role: 'organizer' },
		] );
		expect( body.team.members.map( ( m ) => m.sourceId ) ).toEqual(
			[ bea.id, cris.id ].sort( ( a, b ) => a - b )
		);
		expect(
			body.team.members.find( ( m ) => m.sourceId === bea.id )
				.portraitMediaId
		).toBe( `media:${ media.portrait.id }` );
		// One entry per attachment, sorted by ID, though the portrait is
		// referenced three times.
		expect( body.media ).toEqual(
			[ media.poster, media.portrait ]
				.sort( ( a, b ) => a.id - b.id )
				.map( ( m ) => mediaEntry( m ) )
		);

		// The series' own read has unshifted times and the same IDs.
		const master = await readComplete( series.id );
		expect( master.body.scheduleEventDateId ).toBe( series.id );
		expect( master.body.schedule.items[ 0 ].startsAtLocal ).toBe(
			'2037-03-04T18:00:00'
		);
	} );

	test( 'an edit committed while the read is paused is either fully visible or not at all', async () => {
		const event = await createEvent();
		const dana = await createMember( { name: 'Dana', surname: 'Old' } );
		for ( const itemId of [ event.workshopId, event.standaloneId ] ) {
			await call(
				'post',
				`${ eventPath( event.id ) }/schedule-items/${ itemId }/contributors`,
				{ member_id: dana.id, role: 'teacher' }
			);
		}

		// Pause at the first contributor query, after the programme was
		// read. A second connection then commits one logical edit: Dana is
		// renamed and a new programme item is added. The paused read must
		// not mix the new profile or item into the old programme.
		const paused = await completeInProcess(
			event.id,
			`
			$GLOBALS['cf2424_done'] = false;
			add_filter( 'query', static function ( $q ) {
				global $wpdb;
				if ( $GLOBALS['cf2424_done'] || false === strpos( $q, 'fair_events_team_memberships' ) || false !== strpos( $q, 'information_schema' ) ) {
					return $q;
				}
				$GLOBALS['cf2424_done'] = true;
				$other = new wpdb( DB_USER, DB_PASSWORD, DB_NAME, DB_HOST );
				$other->set_prefix( $wpdb->prefix );
				$other->query( 'START TRANSACTION' );
				$other->update( $wpdb->prefix . 'fair_events_team_members', array( 'name' => 'Dana', 'surname' => 'New' ), array( 'id' => ${ dana.id } ) );
				$other->insert( $wpdb->prefix . 'fair_events_schedule_items', array( 'event_date_id' => ${ event.id }, 'ticket_option_id' => null, 'bookable' => 0, 'title' => 'Late jam', 'start_datetime' => '2037-03-04 21:00:00', 'end_datetime' => '2037-03-04 21:30:00', 'description' => '', 'location' => '', 'sort_order' => 9 ) );
				$other->query( 'COMMIT' );
				$GLOBALS['cf2424_seen'] = array(
					'other' => $other->get_var( $other->prepare( 'SELECT surname FROM %i WHERE id = %d', $wpdb->prefix . 'fair_events_team_members', ${ dana.id } ) ),
					'paused' => $wpdb->get_var( $wpdb->prepare( 'SELECT surname FROM %i WHERE id = %d', $wpdb->prefix . 'fair_events_team_members', ${ dana.id } ) ),
				);
				$other->close();
				return $q;
			} );
			`,
			"$extra = $GLOBALS['cf2424_seen'] ?? null;"
		);

		// The edit was committed mid-read; the paused read did not see it.
		expect( paused.extra ).toEqual( { other: 'New', paused: 'Old' } );
		expect( paused.status, JSON.stringify( paused.body ) ).toBe( 200 );
		expect( paused.body.schedule.items ).toHaveLength( 2 );
		expect( paused.body.team.members ).toEqual( [
			expect.objectContaining( {
				sourceId: dana.id,
				displayName: 'Dana Old',
			} ),
		] );

		// Read again: both references resolve to the updated profile, and
		// the new item is there.
		const after = await readComplete( event.id );
		expect( after.status, JSON.stringify( after.body ) ).toBe( 200 );
		expect( after.body.schedule.items ).toHaveLength( 3 );
		expect( after.body.team.members ).toEqual( [
			expect.objectContaining( {
				sourceId: dana.id,
				displayName: 'Dana New',
			} ),
		] );
		for ( const itemId of [ event.workshopId, event.standaloneId ] ) {
			expect(
				after.body.schedule.items.find( ( i ) => i.sourceId === itemId )
					.contributors
			).toEqual( [
				{ memberId: `team-member:${ dana.id }`, role: 'teacher' },
			] );
		}

		// Object-cache values from before the snapshot are not used, and
		// nothing read inside it is left in the cache afterwards.
		const cached = await completeInProcess(
			event.id,
			`
			$post = get_post( ${ event.postId } );
			$post->post_title = 'Stale cached title';
			wp_cache_replace( $post->ID, $post, 'posts' );
			`,
			`$extra = array( 'cached' => get_post( ${ event.postId } )->post_title, 'probe' => wp_cache_get( 'snapshot', 'fair_events_campaign_snapshot' ) );`
		);
		expect( cached.status, JSON.stringify( cached.body ) ).toBe( 200 );
		expect( cached.body.event.title ).not.toBe( 'Stale cached title' );
		expect( cached.extra ).toEqual( {
			cached: 'Stale cached title',
			probe: false,
		} );
	} );

	test( 'a non-transactional participating table refuses the read', async () => {
		const event = await createEvent( { schedule: false } );
		const result = await completeInProcess(
			event.id,
			`
			global $wpdb;
			$wpdb->query( 'CREATE TABLE IF NOT EXISTS ' . $wpdb->prefix . 'e2e_2424_myisam ( id int ) ENGINE=MyISAM' );
			add_filter( 'fair_events_campaign_snapshot_tables', static function ( $tables ) { global $wpdb; $tables[] = $wpdb->prefix . 'e2e_2424_myisam'; return $tables; } );
			`,
			"global $wpdb; $wpdb->query( 'DROP TABLE IF EXISTS ' . $wpdb->prefix . 'e2e_2424_myisam' );"
		);
		expect( result.status ).toBe( 503 );
		expect( result.body.code ).toBe(
			'fair_events_campaign_facts_snapshot_unavailable'
		);
		expect( result.body.data ).toMatchObject( {
			reason: 'non_transactional_tables',
			retryable: false,
			tables: [ expect.stringMatching( /e2e_2424_myisam$/ ) ],
		} );
	} );

	test( 'each optional feature unavailable on its own is an explicit 409, and empty collections are complete', async () => {
		const event = await createEvent( { schedule: false } );

		const empty = await readComplete( event.id );
		expect( empty.status, JSON.stringify( empty.body ) ).toBe( 200 );
		expect( empty.body ).toMatchObject( {
			event: { mediaIds: [], focalRegions: {} },
			schedule: { enabled: false, items: [] },
			team: { members: [], eventContributors: [] },
			media: [],
		} );

		try {
			await setFeatures( {
				'team-members': false,
				'event-images': true,
			} );
			const team = await readComplete( event.id );
			expect( team.status ).toBe( 409 );
			expect( team.body.code ).toBe(
				'fair_events_campaign_facts_features_unavailable'
			);
			expect( team.body.data.features ).toEqual( [
				{ feature: 'team-members', reason: 'disabled' },
			] );

			await setFeatures( {
				'team-members': true,
				'event-images': false,
			} );
			const images = await readComplete( event.id );
			expect( images.status ).toBe( 409 );
			expect( images.body.data.features ).toEqual( [
				{ feature: 'event-images', reason: 'disabled' },
			] );
		} finally {
			await setFeatures( { 'team-members': true, 'event-images': true } );
		}

		// Fair Events Experimental inactive: no provider answers.
		const inactive = await completeInProcess(
			event.id,
			"remove_all_filters( 'fair_events_campaign_contributors' ); remove_all_filters( 'fair_events_campaign_team_profiles' ); remove_all_filters( 'fair_events_campaign_media' );"
		);
		expect( inactive.status ).toBe( 409 );
		expect( inactive.body.data.features ).toEqual( [
			{ feature: 'team-members', reason: 'not_provided' },
			{ feature: 'event-images', reason: 'not_provided' },
		] );
	} );

	test( 'access: anonymous, without edit_posts, and without edit_post on the series page', async () => {
		const series = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=2',
			schedule: false,
		} );

		const anonymous = await api.get( completePath( series.id ) );
		expect( anonymous.status() ).toBe( 401 );

		const subscriber = await readComplete(
			series.id,
			await createUser( 'subscriber' )
		);
		expect( subscriber.status ).toBe( 403 );

		// An author can edit posts, but not the administrator's series page,
		// which a generated occurrence resolves to.
		const author = await createUser( 'author' );
		for ( const id of [ series.id, series.occurrenceIds[ 0 ] ] ) {
			const denied = await readComplete( id, author );
			expect( denied.status, JSON.stringify( denied.body ) ).toBe( 403 );
			expect( denied.body.code ).toBe( 'rest_forbidden' );
		}

		const editor = await createUser( 'editor' );
		expect(
			( await readComplete( series.occurrenceIds[ 0 ], editor ) ).status
		).toBe( 200 );

		const missing = await readComplete( 999999999 );
		expect( missing.status ).toBe( 404 );
		expect( missing.body.code ).toBe( 'rest_event_date_not_found' );
	} );

	test( 'broken references and failed queries are errors, never empty results', async () => {
		const event = await createEvent();
		const eli = await createMember( { name: 'Eli' } );
		await call(
			'post',
			`${ eventPath( event.id ) }/schedule-items/${
				event.workshopId
			}/contributors`,
			{ member_id: eli.id, role: 'teacher' }
		);
		await saveImages( event.id, event.workshopId, [
			{ attachmentId: media.stage.id, focalRegion: null },
		] );
		expect( ( await readComplete( event.id ) ).status ).toBe( 200 );

		const cases = [
			[
				'ticket option gone',
				rewriteQuery(
					'fair_events_ticket_options',
					"str_replace( 'WHERE event_date_id', 'WHERE 1 = 0 AND event_date_id', $q )"
				),
				500,
				'fair_events_schedule_ticket_option_missing',
			],
			[
				'profile gone',
				rewriteQuery(
					'portrait_attachment_id FROM',
					"str_replace( 'WHERE id IN', 'WHERE 1 = 0 AND id IN', $q )"
				),
				500,
				'fair_events_team_member_missing',
			],
			[
				'attachment gone',
				`add_filter( 'query', static function ( $q ) { return ( false !== strpos( $q, 'wp_posts' ) && false !== strpos( $q, 'ID = ${ media.stage.id }' ) ) ? 'SELECT * FROM wp_posts WHERE 1 = 0' : $q; } );`,
				500,
				'fair_events_event_image_missing',
			],
			[
				'schedule query failed',
				rewriteQuery(
					'fair_events_schedule_items',
					"'SELECT broken FROM nowhere_2424'"
				),
				500,
				'fair_events_source_unavailable',
			],
			[
				'images query failed',
				rewriteQuery(
					'fair_events_experimental_event_images',
					"'SELECT broken FROM nowhere_2424'"
				),
				500,
				'fair_events_source_unavailable',
			],
		];

		for ( const [ label, setup, status, code ] of cases ) {
			const result = await completeInProcess( event.id, setup );
			expect( [ label, result.status, result.body.code ] ).toEqual( [
				label,
				status,
				code,
			] );
		}
	} );
} );
