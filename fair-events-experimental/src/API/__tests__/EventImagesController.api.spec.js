/**
 * Playwright API tests for EventImagesController (#2397): ordered images
 * with optional focal circles for an event and its programme items.
 *
 * GET  /fair-events-experimental/v1/event-dates/{id}/images
 * PUT  …/images/event
 * PUT  …/images/schedule-items/{schedule_item_id}
 *
 * Covers the `event-images` bundle (routes off, data kept), access,
 * deterministic order with stable IDs, explicit null circles, invalid
 * images and circles, independent circles for one attachment in two lists,
 * standalone and workshop programme items, items of another event or
 * removed from the schedule, stale saves, non-square and EXIF-oriented
 * sources (rotated by WordPress or not), in-place edits, trash, permanent
 * deletion, a series read from its occurrence, and event deletion.
 *
 * The suite removes the events, posts, attachments and users it creates,
 * and restores the bundle setting it found.
 */

import { test, expect, request } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const EVENT_DATES_PATH = '/wp-json/fair-events/v1/event-dates';
const IMAGES_BASE = '/wp-json/fair-events-experimental/v1/event-dates';
const FEATURES_OPTION = 'fair_events_experimental_features';
const USER_PASSWORD = 'Test-password-2397!';

const basic = ( user, password ) => ( {
	Authorization:
		'Basic ' +
		Buffer.from( `${ user }:${ password }` ).toString( 'base64' ),
} );
const adminHeaders = basic( ADMIN_USER, ADMIN_PASSWORD );

const ROOT = new URL( '../../../../', import.meta.url );

/** Run WP-CLI on the tests instance without blocking the event loop. */
async function wp( ...args ) {
	const { stdout } = await promisify( execFile )(
		'npx',
		[ 'wp-env', 'run', 'tests-cli', 'wp', ...args ],
		{ cwd: ROOT, encoding: 'utf8' }
	);
	return stdout;
}

/** Run the media fixture script and parse its result. */
async function fixture( ...args ) {
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

test.describe( 'EventImagesController', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let savedFeatures = null;
	const eventDateIds = [];
	const postIds = [];
	const attachmentIds = [];
	const userIds = [];
	const media = {};

	const imagesPath = ( id ) => `${ IMAGES_BASE }/${ id }/images`;
	const read = async ( id, headers = adminHeaders ) => {
		const res = await api.get( imagesPath( id ), { headers } );
		return { status: res.status(), body: await res.json() };
	};
	const saveList = async ( id, itemId, data, headers = adminHeaders ) => {
		const path = itemId
			? `${ imagesPath( id ) }/schedule-items/${ itemId }`
			: `${ imagesPath( id ) }/event`;
		const res = await api.put( path, { headers, data } );
		return { status: res.status(), body: await res.json() };
	};
	/** Save the event's own list from its current revision. */
	const saveEvent = async ( id, images ) => {
		const current = await read( id );
		return saveList( id, 0, {
			revision: current.body.event.revision,
			images,
		} );
	};
	const listOf = ( body, itemId ) =>
		itemId
			? body.scheduleItems.find( ( i ) => i.scheduleItemId === itemId )
			: body.event;
	/** Payload entries for the associations as read. */
	const asPayload = ( images ) =>
		images.map( ( image ) => ( {
			id: image.id,
			attachmentId: image.attachmentId,
			focalRegion: image.focalRegion,
			sourceRevision: image.sourceRevision,
		} ) );

	const setBundle = async ( enabled ) => {
		const next = { ...( savedFeatures || {} ), 'event-images': enabled };
		await wp(
			'option',
			'update',
			FEATURES_OPTION,
			JSON.stringify( next ),
			'--format=json'
		);
	};

	const createMedia = async ( ...args ) => {
		const result = await fixture( ...args );
		attachmentIds.push( result.id );
		return result;
	};

	/**
	 * Create a post-linked event, optionally a series, with a schedule of
	 * one workshop and one standalone item.
	 *
	 * @param {Object} [options]
	 * @param {string} [options.rrule] Recurrence rule.
	 * @return {Promise<Object>} `{ id, postId, occurrenceIds, workshopItemId, breakItemId }`.
	 */
	const createEvent = async ( { rrule } = {} ) => {
		const title = `Event images ${ Date.now() } ${ Math.random() }`;
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		postIds.push( postId );

		const edRes = await api.post( EVENT_DATES_PATH, {
			headers: adminHeaders,
			data: {
				title,
				link_type: 'post',
				start_date: '2035-10-06',
				end_date: '2035-10-06',
				start_time: '09:00:00',
				end_time: '18:00:00',
				...( rrule ? { rrule } : {} ),
			},
		} );
		const edBody = await edRes.json();
		expect( edRes.ok(), JSON.stringify( edBody ) ).toBeTruthy();
		const id = edBody.id;
		const occurrenceIds = ( edBody.generated_occurrences || [] ).map(
			( o ) => o.id
		);
		eventDateIds.push( id, ...occurrenceIds );

		const link = await api.put( `${ EVENT_DATES_PATH }/${ id }`, {
			headers: adminHeaders,
			data: { event_id: postId },
		} );
		expect( link.ok() ).toBeTruthy();

		const tickets = await api.put(
			`${ EVENT_DATES_PATH }/${ id }/tickets`,
			{
				headers: adminHeaders,
				data: {
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
							name: 'Always on',
							sale_start: '2020-01-01 00:00:00',
							sale_end: '2099-01-01 00:00:00',
						},
					],
					prices: [
						{
							ticket_type_index: 0,
							sale_period_index: 0,
							price: 0,
						},
					],
					options: [ { name: 'Acro', price: 0, capacity: null } ],
					settings: { schedule_enabled: true },
				},
			}
		);
		const ticketsBody = await tickets.json();
		expect( tickets.ok(), JSON.stringify( ticketsBody ) ).toBeTruthy();
		const optionId = ticketsBody.options[ 0 ].id;

		const schedule = await api.put(
			`${ EVENT_DATES_PATH }/${ id }/schedule`,
			{
				headers: adminHeaders,
				data: {
					items: [
						{
							key: 'w',
							ticket_option_id: optionId,
							bookable: true,
							start_datetime: '2035-10-06 10:00:00',
							end_datetime: '2035-10-06 11:00:00',
						},
						{
							key: 'b',
							title: 'Lunch break',
							bookable: false,
							start_datetime: '2035-10-06 13:00:00',
							end_datetime: '2035-10-06 14:00:00',
						},
					],
				},
			}
		);
		const scheduleBody = await schedule.json();
		expect( schedule.ok(), JSON.stringify( scheduleBody ) ).toBeTruthy();
		const workshop = scheduleBody.items.find( ( i ) => i.ticket_option_id );
		const lunch = scheduleBody.items.find( ( i ) => ! i.ticket_option_id );

		return {
			id,
			postId,
			occurrenceIds,
			optionId,
			workshopItemId: workshop.id,
			breakItemId: lunch.id,
		};
	};

	const createUser = async ( role ) => {
		const login = `event-images-${ role }-${ Date.now() }`;
		const res = await api.post( '/wp-json/wp/v2/users', {
			headers: adminHeaders,
			data: {
				username: login,
				email: `${ login }@example.test`,
				password: USER_PASSWORD,
				roles: [ role ],
			},
		} );
		expect( res.ok() ).toBeTruthy();
		userIds.push( ( await res.json() ).id );
		return basic( login, USER_PASSWORD );
	};

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
		await setBundle( true );

		media.wide = await createMedia( 'png', '400', '100' );
		media.square = await createMedia( 'png', '120', '120' );
		media.third = await createMedia( 'png', '200', '150' );
		media.rotated = await createMedia( 'jpeg-rotated', '300', '200' );
		media.unrotated = await createMedia( 'jpeg-unrotated', '300', '200' );
		media.noSize = await createMedia( 'no-size' );
		media.pdf = await createMedia( 'pdf' );
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
		if ( attachmentIds.length ) {
			await fixture( 'cleanup', ...attachmentIds.map( String ) ).catch(
				() => {}
			);
		}
		for ( const id of userIds ) {
			await api.delete(
				`/wp-json/wp/v2/users/${ id }?force=true&reassign=1`,
				{ headers: adminHeaders }
			);
		}
		await api.dispose();
	} );

	test( 'an event starts with empty lists for itself and each saved programme item', async () => {
		const event = await createEvent();
		const { status, body } = await read( event.id );
		expect( status ).toBe( 200 );
		expect( body ).toMatchObject( {
			eventDateId: event.id,
			ownerEventDateId: event.id,
			readOnly: false,
			ownerEditUrl: null,
			scheduleAvailable: true,
			event: { images: [] },
		} );
		expect(
			body.scheduleItems.map( ( item ) => [
				item.scheduleItemId,
				item.ticketOptionId,
				item.images,
			] )
		).toEqual(
			expect.arrayContaining( [
				[ event.workshopItemId, event.optionId, [] ],
				[ event.breakItemId, null, [] ],
			] )
		);
		// Every empty list has the same revision.
		expect(
			new Set( [
				body.event.revision,
				...body.scheduleItems.map( ( i ) => i.revision ),
			] ).size
		).toBe( 1 );
	} );

	test( 'order is saved and returned deterministically, with stable IDs across reorders and circle edits', async () => {
		const event = await createEvent();
		const first = await saveEvent( event.id, [
			{ attachmentId: media.wide.id, focalRegion: null },
			{ attachmentId: media.square.id, focalRegion: null },
			{ attachmentId: media.third.id, focalRegion: null },
		] );
		expect( first.status, JSON.stringify( first.body ) ).toBe( 200 );
		const saved = first.body.event.images;
		expect( saved.map( ( i ) => i.attachmentId ) ).toEqual( [
			media.wide.id,
			media.square.id,
			media.third.id,
		] );
		expect( saved.map( ( i ) => i.position ) ).toEqual( [ 0, 1, 2 ] );
		expect( saved[ 0 ] ).toMatchObject( {
			available: true,
			sourceUrl: media.wide.url,
			width: 400,
			height: 100,
			focalRegion: null,
			focalRegionNeedsReview: false,
		} );

		// Reload twice: identical.
		const a = await read( event.id );
		const b = await read( event.id );
		expect( a.body ).toEqual( b.body );
		expect( a.body.event.images ).toEqual( saved );

		// Reorder and add a circle: IDs are kept.
		const payload = asPayload( saved );
		const reordered = [ payload[ 2 ], payload[ 0 ], payload[ 1 ] ];
		reordered[ 1 ].focalRegion = {
			centerX: 0.25,
			centerY: 0.5,
			radius: 0.4,
		};
		const second = await saveList( event.id, 0, {
			revision: a.body.event.revision,
			images: reordered,
		} );
		expect( second.status, JSON.stringify( second.body ) ).toBe( 200 );
		const after = second.body.event.images;
		expect( after.map( ( i ) => i.id ) ).toEqual( [
			saved[ 2 ].id,
			saved[ 0 ].id,
			saved[ 1 ].id,
		] );
		expect( after[ 1 ].focalRegion ).toEqual( {
			centerX: 0.25,
			centerY: 0.5,
			radius: 0.4,
		} );
		expect( ( await read( event.id ) ).body.event.images ).toEqual( after );
	} );

	test( 'a circle is restored exactly and removed back to an explicit null', async () => {
		const event = await createEvent();
		const circle = { centerX: 0.323457, centerY: 0.654321, radius: 0.2 };
		const saved = await saveEvent( event.id, [
			{ attachmentId: media.third.id, focalRegion: null },
		] );
		const [ image ] = saved.body.event.images;
		const withCircle = await saveList( event.id, 0, {
			revision: saved.body.event.revision,
			images: [ { ...asPayload( [ image ] )[ 0 ], focalRegion: circle } ],
		} );
		expect( withCircle.status, JSON.stringify( withCircle.body ) ).toBe(
			200
		);
		expect(
			( await read( event.id ) ).body.event.images[ 0 ].focalRegion
		).toEqual( circle );

		const removed = await saveList( event.id, 0, {
			revision: withCircle.body.event.revision,
			images: [ { id: image.id, attachmentId: image.attachmentId } ],
		} );
		expect( removed.status ).toBe( 200 );
		const reread = ( await read( event.id ) ).body.event.images[ 0 ];
		expect( reread ).toHaveProperty( 'focalRegion', null );
		expect( reread.id ).toBe( image.id );
		const rows = await fixture( 'rows', String( event.id ) );
		expect( rows[ 0 ] ).toMatchObject( {
			center_x: null,
			center_y: null,
			radius: null,
		} );
	} );

	test( 'invalid circles and images are refused and change nothing', async () => {
		const event = await createEvent();
		const base = await saveEvent( event.id, [
			{ attachmentId: media.wide.id, focalRegion: null },
		] );
		const [ wide ] = asPayload( base.body.event.images );
		const attempt = ( images ) =>
			saveList( event.id, 0, {
				revision: base.body.event.revision,
				images,
			} );
		const withCircle = ( focalRegion ) =>
			attempt( [ { ...wide, focalRegion } ] );

		// 400 × 100: radius is a fraction of the shorter side (100 px).
		const cases = [
			[
				{ centerX: 0.5, centerY: 0.5, radius: 0 },
				'radius_not_positive',
			],
			[
				{ centerX: 0.5, centerY: 0.5, radius: -0.1 },
				'radius_not_positive',
			],
			// 50 px radius needs the centre exactly halfway down.
			[ { centerX: 0.5, centerY: 0.4, radius: 0.5 }, 'outside_image' ],
			// 40 px from the left, 50 px radius.
			[ { centerX: 0.1, centerY: 0.5, radius: 0.5 }, 'outside_image' ],
			[ { centerX: 1.2, centerY: 0.5, radius: 0.1 }, 'outside_image' ],
			[ { centerX: 'left', centerY: 0.5, radius: 0.1 }, 'malformed' ],
			[ { centerX: 0.5, radius: 0.1 }, 'malformed' ],
			[ [ 0.5, 0.5, 0.1 ], 'malformed' ],
		];
		for ( const [ circle, reason ] of cases ) {
			const res = await withCircle( circle );
			expect( res.status, JSON.stringify( circle ) ).toBe( 400 );
			expect( res.body.code ).toBe( 'event_images_invalid_focal_region' );
			expect( res.body.data ).toMatchObject( { index: 0, reason } );
		}

		// The largest circle that fits a 400 × 100 image is accepted.
		const fits = await withCircle( {
			centerX: 0.125,
			centerY: 0.5,
			radius: 0.5,
		} );
		expect( fits.status, JSON.stringify( fits.body ) ).toBe( 200 );
		const fitsRevision = fits.body.event.revision;
		const again = ( images ) =>
			saveList( event.id, 0, { revision: fitsRevision, images } );

		const pdf = await again( [
			{ attachmentId: media.pdf.id, focalRegion: null },
		] );
		expect( pdf.status ).toBe( 400 );
		expect( pdf.body ).toMatchObject( {
			code: 'event_images_invalid_attachment',
			data: { reason: 'not_image', index: 0 },
		} );

		const missing = await again( [
			{ attachmentId: 99999999, focalRegion: null },
		] );
		expect( missing.status ).toBe( 400 );
		expect( missing.body.data.reason ).toBe( 'missing' );

		const duplicate = await again( [
			{ attachmentId: media.square.id },
			{ attachmentId: media.square.id },
		] );
		expect( duplicate.status ).toBe( 400 );
		expect( duplicate.body ).toMatchObject( {
			code: 'event_images_duplicate',
			data: { index: 1 },
		} );

		// No size known: the link is fine, a circle is not.
		const noSize = await again( [ { attachmentId: media.noSize.id } ] );
		expect( noSize.status, JSON.stringify( noSize.body ) ).toBe( 200 );
		const [ noSizeImage ] = noSize.body.event.images;
		expect( noSizeImage ).toMatchObject( {
			width: null,
			height: null,
			focalRegion: null,
		} );
		const noSizeCircle = await saveList( event.id, 0, {
			revision: noSize.body.event.revision,
			images: [
				{
					...asPayload( [ noSizeImage ] )[ 0 ],
					focalRegion: { centerX: 0.5, centerY: 0.5, radius: 0.1 },
				},
			],
		} );
		expect( noSizeCircle.status ).toBe( 400 );
		expect( noSizeCircle.body.data.reason ).toBe( 'dimensions_unknown' );

		// An ID from the list cannot be pointed at another attachment.
		const swapped = await saveList( event.id, 0, {
			revision: noSize.body.event.revision,
			images: [ { id: noSizeImage.id, attachmentId: media.square.id } ],
		} );
		expect( swapped.status ).toBe( 400 );
		expect( swapped.body.code ).toBe( 'event_images_invalid' );

		const tooMany = await again(
			Array.from( { length: 51 }, ( _, i ) => ( {
				attachmentId: i + 1,
			} ) )
		);
		expect( tooMany.status ).toBe( 400 );

		// Only the accepted saves changed anything.
		const final = ( await read( event.id ) ).body.event.images;
		expect( final.map( ( i ) => i.attachmentId ) ).toEqual( [
			media.noSize.id,
		] );
	} );

	test( 'one attachment in two lists keeps an independent circle in each', async () => {
		const event = await createEvent();
		const eventCircle = { centerX: 0.3, centerY: 0.3, radius: 0.2 };
		const itemCircle = { centerX: 0.7, centerY: 0.6, radius: 0.3 };
		const initial = await read( event.id );

		const own = await saveEvent( event.id, [
			{ attachmentId: media.square.id },
		] );
		const ownImage = own.body.event.images[ 0 ];
		const ownSaved = await saveList( event.id, 0, {
			revision: own.body.event.revision,
			images: [
				{ ...asPayload( [ ownImage ] )[ 0 ], focalRegion: eventCircle },
			],
		} );
		expect( ownSaved.status ).toBe( 200 );

		const workshop = await saveList( event.id, event.workshopItemId, {
			revision: listOf( initial.body, event.workshopItemId ).revision,
			images: [ { attachmentId: media.square.id } ],
		} );
		expect( workshop.status, JSON.stringify( workshop.body ) ).toBe( 200 );
		const workshopList = listOf( workshop.body, event.workshopItemId );
		const workshopImage = workshopList.images[ 0 ];
		expect( workshopImage.id ).not.toBe( ownImage.id );
		expect( workshopImage.focalRegion ).toBeNull();

		const itemSaved = await saveList( event.id, event.workshopItemId, {
			revision: workshopList.revision,
			images: [
				{
					...asPayload( [ workshopImage ] )[ 0 ],
					focalRegion: itemCircle,
				},
			],
		} );
		expect( itemSaved.status ).toBe( 200 );

		const { body } = await read( event.id );
		expect( body.event.images[ 0 ].focalRegion ).toEqual( eventCircle );
		expect(
			listOf( body, event.workshopItemId ).images[ 0 ].focalRegion
		).toEqual( itemCircle );
		expect( listOf( body, event.breakItemId ).images ).toEqual( [] );
	} );

	test( 'standalone items are supported; items of another event or removed from the schedule are not', async () => {
		const event = await createEvent();
		const other = await createEvent();
		const initial = await read( event.id );

		const lunch = await saveList( event.id, event.breakItemId, {
			revision: listOf( initial.body, event.breakItemId ).revision,
			images: [ { attachmentId: media.third.id } ],
		} );
		expect( lunch.status, JSON.stringify( lunch.body ) ).toBe( 200 );
		expect(
			listOf( lunch.body, event.breakItemId ).images[ 0 ].attachmentId
		).toBe( media.third.id );

		const foreign = await saveList( event.id, other.breakItemId, {
			revision: initial.body.event.revision,
			images: [ { attachmentId: media.third.id } ],
		} );
		expect( foreign.status ).toBe( 404 );
		expect( foreign.body.code ).toBe(
			'event_images_schedule_item_not_found'
		);

		// Remove the break from the schedule, keeping the workshop.
		const schedule = await api.get(
			`${ EVENT_DATES_PATH }/${ event.id }/schedule`,
			{ headers: adminHeaders }
		);
		const workshopEntry = ( await schedule.json() ).items.find(
			( i ) => i.id === event.workshopItemId
		);
		const trimmed = await api.put(
			`${ EVENT_DATES_PATH }/${ event.id }/schedule`,
			{ headers: adminHeaders, data: { items: [ workshopEntry ] } }
		);
		expect( trimmed.ok() ).toBeTruthy();

		const after = await read( event.id );
		expect(
			after.body.scheduleItems.map( ( i ) => i.scheduleItemId )
		).toEqual( [ event.workshopItemId ] );

		// A stale editor still holding the removed item cannot save it.
		const stale = await saveList( event.id, event.breakItemId, {
			revision: listOf( lunch.body, event.breakItemId ).revision,
			images: [ { attachmentId: media.third.id } ],
		} );
		expect( stale.status ).toBe( 404 );

		// The next write drops the removed item's links.
		await saveEvent( event.id, [] );
		const rows = await fixture( 'rows', String( event.id ) );
		expect(
			rows.filter(
				( row ) => Number( row.schedule_item_id ) === event.breakItemId
			)
		).toEqual( [] );
	} );

	test( 'a save from a stale revision is refused with 409', async () => {
		const event = await createEvent();
		const before = await read( event.id );
		const first = await saveList( event.id, 0, {
			revision: before.body.event.revision,
			images: [ { attachmentId: media.wide.id } ],
		} );
		expect( first.status ).toBe( 200 );

		const stale = await saveList( event.id, 0, {
			revision: before.body.event.revision,
			images: [ { attachmentId: media.square.id } ],
		} );
		expect( stale.status ).toBe( 409 );
		expect( stale.body.code ).toBe( 'event_images_revision_mismatch' );
		expect(
			( await read( event.id ) ).body.event.images.map(
				( i ) => i.attachmentId
			)
		).toEqual( [ media.wide.id ] );
	} );

	test( 'EXIF-oriented sources report oriented dimensions, rotated by WordPress or not', async () => {
		// Both are stored 300 × 200 with orientation 6, displayed 200 × 300.
		expect( media.rotated ).toMatchObject( {
			width: 200,
			height: 300,
			orientation: 1,
			rotated: true,
		} );
		expect( media.unrotated ).toMatchObject( {
			width: 300,
			height: 200,
			orientation: 6,
		} );

		const event = await createEvent();
		const saved = await saveEvent( event.id, [
			{ attachmentId: media.rotated.id },
			{ attachmentId: media.unrotated.id },
		] );
		expect( saved.status, JSON.stringify( saved.body ) ).toBe( 200 );
		for ( const image of saved.body.event.images ) {
			expect( image ).toMatchObject( { width: 200, height: 300 } );
		}
		expect( saved.body.event.images[ 0 ].sourceUrl ).toBe(
			media.rotated.url
		);

		// A 100 px radius fits the 200 px width, not the stored 200 px height.
		const payload = asPayload( saved.body.event.images ).map(
			( image ) => ( {
				...image,
				focalRegion: { centerX: 0.5, centerY: 0.4, radius: 0.5 },
			} )
		);
		const circles = await saveList( event.id, 0, {
			revision: saved.body.event.revision,
			images: payload,
		} );
		expect( circles.status, JSON.stringify( circles.body ) ).toBe( 200 );
		const outside = await saveList( event.id, 0, {
			revision: circles.body.event.revision,
			images: payload.map( ( image ) => ( {
				...image,
				id: undefined,
				focalRegion: { centerX: 0.4, centerY: 0.5, radius: 0.5 },
			} ) ),
		} );
		expect( outside.status ).toBe( 400 );
		expect( outside.body.data.reason ).toBe( 'outside_image' );
	} );

	test( 'an in-place edit withholds the circle for review; trash and deletion are handled', async () => {
		const edited = await createMedia( 'png', '300', '200' );
		const doomed = await createMedia( 'png', '100', '100' );
		const event = await createEvent();
		const circle = { centerX: 0.5, centerY: 0.5, radius: 0.3 };
		const saved = await saveEvent( event.id, [
			{ attachmentId: media.square.id },
			{ attachmentId: doomed.id },
			{ attachmentId: edited.id },
		] );
		const withCircles = await saveList( event.id, 0, {
			revision: saved.body.event.revision,
			images: asPayload( saved.body.event.images ).map( ( image ) => ( {
				...image,
				focalRegion: circle,
			} ) ),
		} );
		expect( withCircles.status ).toBe( 200 );
		const before = withCircles.body.event.images;

		// Edit the third image in place: its circle may point elsewhere now.
		await fixture( 'edit', String( edited.id ) );
		const afterEdit = ( await read( event.id ) ).body.event;
		const editedImage = afterEdit.images[ 2 ];
		expect( editedImage ).toMatchObject( {
			id: before[ 2 ].id,
			width: 150,
			focalRegion: null,
			focalRegionNeedsReview: true,
		} );
		expect( editedImage.sourceRevision ).not.toBe(
			before[ 2 ].sourceRevision
		);

		// The old circle with the old source revision is refused.
		const reuse = await saveList( event.id, 0, {
			revision: afterEdit.revision,
			images: asPayload( afterEdit.images ).map( ( image, index ) =>
				index === 2
					? {
							...image,
							focalRegion: circle,
							sourceRevision: before[ 2 ].sourceRevision,
						}
					: image
			),
		} );
		expect( reuse.status ).toBe( 409 );
		expect( reuse.body.code ).toBe( 'event_images_source_changed' );

		// Trash: still listed, unavailable, never with a circle.
		await fixture( 'trash', String( doomed.id ) );
		const trashed = ( await read( event.id ) ).body.event.images[ 1 ];
		expect( trashed ).toMatchObject( {
			attachmentId: doomed.id,
			available: false,
			unavailableReason: 'trashed',
			sourceUrl: null,
			focalRegion: null,
		} );
		await fixture( 'restore', String( doomed.id ) );

		// Permanent deletion removes the link and keeps the order.
		await fixture( 'delete', String( doomed.id ) );
		const afterDelete = ( await read( event.id ) ).body.event.images;
		expect( afterDelete.map( ( i ) => i.id ) ).toEqual( [
			before[ 0 ].id,
			before[ 2 ].id,
		] );
		expect( afterDelete.map( ( i ) => i.position ) ).toEqual( [ 0, 1 ] );
		const rows = await fixture( 'rows', String( event.id ) );
		expect( rows.map( ( r ) => Number( r.position ) ) ).toEqual( [ 0, 1 ] );
		expect( afterDelete[ 0 ].focalRegion ).toEqual( circle );
	} );

	test( 'a series keeps its images on the master; occurrences read them and cannot write', async () => {
		const series = await createEvent( { rrule: 'FREQ=WEEKLY;COUNT=3' } );
		expect( series.occurrenceIds.length ).toBeGreaterThan( 0 );
		const circle = { centerX: 0.5, centerY: 0.5, radius: 0.25 };
		const saved = await saveEvent( series.id, [
			{ attachmentId: media.square.id },
		] );
		const withCircle = await saveList( series.id, 0, {
			revision: saved.body.event.revision,
			images: [
				{
					...asPayload( saved.body.event.images )[ 0 ],
					focalRegion: circle,
				},
			],
		} );
		expect( withCircle.status ).toBe( 200 );

		const occurrenceId = series.occurrenceIds[ 0 ];
		const occurrence = await read( occurrenceId );
		expect( occurrence.status ).toBe( 200 );
		expect( occurrence.body ).toMatchObject( {
			eventDateId: occurrenceId,
			ownerEventDateId: series.id,
			readOnly: true,
		} );
		expect( occurrence.body.ownerEditUrl ).toContain(
			`event_date_id=${ series.id }`
		);
		expect( occurrence.body.event.images ).toEqual(
			withCircle.body.event.images
		);
		expect(
			occurrence.body.scheduleItems.map( ( i ) => i.scheduleItemId )
		).toEqual(
			withCircle.body.scheduleItems.map( ( i ) => i.scheduleItemId )
		);

		const write = await saveList( occurrenceId, 0, {
			revision: occurrence.body.event.revision,
			images: [],
		} );
		expect( write.status ).toBe( 409 );
		expect( write.body ).toMatchObject( {
			code: 'event_images_managed_on_series',
			data: { owner_event_date_id: series.id },
		} );
	} );

	test( 'access needs event management and edit access to the event page', async () => {
		const event = await createEvent();
		const anonymous = await api.get( imagesPath( event.id ) );
		expect( anonymous.status() ).toBe( 401 );

		const subscriber = await createUser( 'subscriber' );
		expect( ( await read( event.id, subscriber ) ).status ).toBe( 403 );

		// An author manages events but cannot edit the administrator's page.
		const author = await createUser( 'author' );
		expect( ( await read( event.id, author ) ).status ).toBe( 403 );
		const authorWrite = await saveList(
			event.id,
			0,
			{ revision: 'x', images: [] },
			author
		);
		expect( authorWrite.status ).toBe( 403 );

		const editor = await createUser( 'editor' );
		expect( ( await read( event.id, editor ) ).status ).toBe( 200 );

		expect( ( await read( 99999999 ) ).status ).toBe( 404 );
	} );

	test( 'turning the bundle off removes the routes and keeps saved links', async () => {
		const event = await createEvent();
		const circle = { centerX: 0.5, centerY: 0.5, radius: 0.2 };
		const saved = await saveEvent( event.id, [
			{ attachmentId: media.square.id },
		] );
		const withCircle = await saveList( event.id, 0, {
			revision: saved.body.event.revision,
			images: [
				{
					...asPayload( saved.body.event.images )[ 0 ],
					focalRegion: circle,
				},
			],
		} );
		expect( withCircle.status ).toBe( 200 );

		await setBundle( false );
		try {
			const off = await read( event.id );
			expect( off.status ).toBe( 404 );
			expect( off.body.code ).toBe( 'rest_no_route' );
			const offWrite = await saveList( event.id, 0, {
				revision: withCircle.body.event.revision,
				images: [],
			} );
			expect( offWrite.status ).toBe( 404 );
		} finally {
			await setBundle( true );
		}

		expect( ( await read( event.id ) ).body.event ).toEqual(
			withCircle.body.event
		);
	} );

	test( 'deleting an event removes its image links', async () => {
		const event = await createEvent();
		await saveEvent( event.id, [ { attachmentId: media.square.id } ] );
		expect( await fixture( 'rows', String( event.id ) ) ).toHaveLength( 1 );

		const res = await api.delete( `${ EVENT_DATES_PATH }/${ event.id }`, {
			headers: adminHeaders,
		} );
		expect( res.ok() ).toBeTruthy();
		expect( await fixture( 'rows', String( event.id ) ) ).toEqual( [] );
		// The attachment itself stays.
		expect(
			(
				await saveEvent( ( await createEvent() ).id, [
					{ attachmentId: media.square.id },
				] )
			).status
		).toBe( 200 );
	} );
} );
