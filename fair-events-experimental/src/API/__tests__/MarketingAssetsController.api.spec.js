/**
 * Playwright API tests for occurrence marketing assets (#2396):
 * MarketingAssetsController (`/fair-events/v1/event-dates/{id}/marketing-assets`).
 *
 * Covers the `marketing-assets` bundle (off by default) hiding every route
 * while keeping stored assets, administrator-only access, text-only,
 * image-only and combined assets, exact text round-trips, PNG/JPEG
 * uploads through the core media route and refused files, team and
 * schedule links scoped to the event (a series' team and schedule on a
 * generated occurrence), occurrence isolation, cleanup when a member is
 * unlinked, a schedule item removed, an attachment deleted or an
 * occurrence deleted, links kept while team management is off, and
 * anonymous direct-image URLs that keep working through detachment,
 * deletion and disabling the bundle.
 *
 * Linking a member needs `publish_member_names` since #2430; the public
 * side is covered by PublicMarketingAssetsController.api.spec.js.
 *
 * The suite removes the events, profiles, attachments and user it creates,
 * and leaves both bundles off (their default).
 */

import { test, expect, request } from '@playwright/test';
import { png } from '../../../../e2e/support/png.js';
import {
	BASE_URL,
	EVENT_DATES_PATH,
	adminHeaders,
	assetsPath,
	basic,
	evalJson,
	setBundles,
	wp,
} from './helpers/marketing-fixtures.js';

const EDITOR_PASSWORD = 'Test-password-2396!';

// Unicode, CRLF and LF line breaks, tabs, leading/trailing and repeated
// spaces, a combining accent, an emoji ZWJ sequence and markup-like text.
const EXACT_TEXT =
	'  Ven al taller 🎉\r\n\tPlazas: 20  \n\nCafé é 👩‍👩‍👧 <b>not bold</b> &amp;\n  ';

test.describe( 'MarketingAssetsController', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let anon;
	let editorId;
	let editorHeaders;
	const eventDateIds = [];
	const memberIds = [];
	const attachmentIds = [];

	const createEvent = async ( { rrule, startDate = '2035-10-03' } = {} ) => {
		const res = await api.post( EVENT_DATES_PATH, {
			headers: adminHeaders,
			data: {
				title: `Marketing event ${ Date.now() } ${ Math.random() }`,
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

	const createMember = async ( name ) => {
		const res = await api.post( '/wp-json/fair-events/v1/team-members', {
			headers: adminHeaders,
			data: { name, surname: 'Test' },
		} );
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 201 );
		memberIds.push( body.id );
		return body.id;
	};

	const linkMember = async ( eventDateId, memberId ) => {
		const res = await api.post(
			`${ EVENT_DATES_PATH }/${ eventDateId }/team-members`,
			{ headers: adminHeaders, data: { member_id: memberId } }
		);
		expect( res.ok() ).toBeTruthy();
	};

	/** Enable the schedule on an event and save the given entries. */
	const saveSchedule = async ( eventDateId, titles ) => {
		await wp(
			'eval',
			`FairEvents\\Models\\EventDateSetting::set( ${ Number(
				eventDateId
			) }, 'schedule_enabled', '1' );`
		);
		const res = await api.put(
			`${ EVENT_DATES_PATH }/${ eventDateId }/schedule`,
			{
				headers: adminHeaders,
				data: {
					items: titles.map( ( title, i ) => ( {
						title,
						start_datetime: `2035-10-03 1${ i }:00:00`,
						end_datetime: `2035-10-03 1${ i }:30:00`,
					} ) ),
				},
			}
		);
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		return body.items.map( ( item ) => item.id );
	};

	const upload = async ( name, bytes, type ) => {
		const res = await api.post( '/wp-json/wp/v2/media', {
			headers: {
				...adminHeaders,
				'Content-Type': type,
				'Content-Disposition': `attachment; filename="${ name }"`,
			},
			data: bytes,
		} );
		const body = await res.json();
		if ( res.ok() ) {
			attachmentIds.push( body.id );
		}
		return { res, body };
	};

	const create = ( eventDateId, data, headers = adminHeaders ) =>
		api.post( assetsPath( eventDateId ), { headers, data } );
	const createOk = async ( eventDateId, data ) => {
		const res = await create( eventDateId, data );
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 201 );
		return body;
	};
	const patch = ( eventDateId, id, data ) =>
		api.patch( `${ assetsPath( eventDateId ) }/${ id }`, {
			headers: adminHeaders,
			data,
		} );
	const read = ( eventDateId, id ) =>
		api.get( `${ assetsPath( eventDateId ) }/${ id }`, {
			headers: adminHeaders,
		} );

	/** Status of an uncached anonymous request for a file URL. */
	const anonymousFileStatus = async ( url ) => {
		const path = new URL( url ).pathname;
		const res = await anon.get( `${ path }?nocache=${ Date.now() }`, {
			headers: { 'Cache-Control': 'no-cache' },
		} );
		return res.status();
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		anon = await request.newContext( { baseURL: BASE_URL } );
		await setBundles( {
			'marketing-assets': true,
			'team-members': true,
		} );
		editorId = Number(
			(
				await wp(
					'user',
					'create',
					`ma-editor-${ Date.now() }`,
					`ma-editor-${ Date.now() }@example.com`,
					'--role=editor',
					`--user_pass=${ EDITOR_PASSWORD }`,
					'--porcelain'
				)
			).trim()
		);
		const login = (
			await wp( 'user', 'get', String( editorId ), '--field=user_login' )
		).trim();
		editorHeaders = basic( login, EDITOR_PASSWORD );
	} );

	test.afterAll( async () => {
		// Omitted keys keep their stored value, so restore explicitly.
		await setBundles( {
			'marketing-assets': false,
			'team-members': false,
		} );
		for ( const id of eventDateIds ) {
			await wp(
				'eval',
				`FairEvents\\Models\\EventDates::delete_by_id( ${ Number(
					id
				) } );`
			);
		}
		for ( const id of attachmentIds ) {
			// Some were already deleted by the tests themselves.
			await wp( 'post', 'delete', String( id ), '--force' ).catch(
				() => {}
			);
		}
		for ( const id of memberIds ) {
			await wp(
				'eval',
				`global $wpdb; $wpdb->delete( $wpdb->prefix . 'fair_events_team_memberships', array( 'member_id' => ${ Number(
					id
				) } ) ); $wpdb->delete( $wpdb->prefix . 'fair_events_team_members', array( 'id' => ${ Number(
					id
				) } ) );`
			);
		}
		if ( editorId ) {
			await wp( 'user', 'delete', String( editorId ), '--yes' );
		}
		await api.dispose();
		await anon.dispose();
	} );

	test( 'requires an administrator', async () => {
		const { id } = await createEvent();

		const anonymous = await anon.get( assetsPath( id ) );
		expect( anonymous.status() ).toBe( 401 );
		const anonymousWrite = await anon.post( assetsPath( id ), {
			data: { label: 'X', text: 'Y' },
		} );
		expect( anonymousWrite.status() ).toBe( 401 );

		const editorRead = await api.get( assetsPath( id ), {
			headers: editorHeaders,
		} );
		expect( editorRead.status() ).toBe( 403 );
		const editorWrite = await create(
			id,
			{ label: 'X', text: 'Y' },
			editorHeaders
		);
		expect( editorWrite.status() ).toBe( 403 );
		const editorOptions = await api.get( `${ assetsPath( id ) }/options`, {
			headers: editorHeaders,
		} );
		expect( editorOptions.status() ).toBe( 403 );

		const missing = await api.get( assetsPath( 99999999 ), {
			headers: adminHeaders,
		} );
		expect( missing.status() ).toBe( 404 );
	} );

	test( 'stores text exactly and requires a label and some content', async () => {
		const { id } = await createEvent();

		const created = await createOk( id, {
			label: 'WhatsApp group message',
			text: EXACT_TEXT,
		} );
		expect( created.text ).toBe( EXACT_TEXT );
		expect( created.image ).toBeNull();

		const reread = await ( await read( id, created.id ) ).json();
		expect( reread.text ).toBe( EXACT_TEXT );
		const stored = await evalJson(
			`global $wpdb; echo 'JSON:' . wp_json_encode( $wpdb->get_var( $wpdb->prepare( 'SELECT text FROM %i WHERE id = %d', $wpdb->prefix . 'fair_events_marketing_assets', ${ Number(
				created.id
			) } ) ) );`
		);
		expect( stored ).toBe( EXACT_TEXT );

		const noLabel = await create( id, { label: ' \t', text: 'Hi' } );
		expect( noLabel.status() ).toBe( 400 );
		expect( ( await noLabel.json() ).data.details.label.code ).toBe(
			'marketing_asset_label_required'
		);

		const missingLabel = await create( id, { text: 'Hi' } );
		expect( missingLabel.status() ).toBe( 400 );

		const empty = await create( id, {
			label: 'Instagram post',
			text: ' \n ​ ',
		} );
		expect( empty.status() ).toBe( 400 );
		expect( ( await empty.json() ).data.details.content.code ).toBe(
			'marketing_asset_content_required'
		);

		const tooLong = await create( id, {
			label: 'Long',
			text: 'x'.repeat( 10001 ),
		} );
		expect( tooLong.status() ).toBe( 400 );

		// Omitted fields keep their value; clearing the only content fails.
		const relabel = await patch( id, created.id, { label: 'Status' } );
		expect( ( await relabel.json() ).text ).toBe( EXACT_TEXT );
		const cleared = await patch( id, created.id, { text: null } );
		expect( cleared.status() ).toBe( 400 );
	} );

	test( 'links PNG and JPEG uploads and refuses other files', async () => {
		const { id } = await createEvent();

		const { body: image } = await upload(
			`ma-${ Date.now() }.png`,
			png( 40, 20 ),
			'image/png'
		);
		const imageOnly = await createOk( id, {
			label: 'WhatsApp status',
			attachment_id: image.id,
		} );
		expect( imageOnly.image ).toMatchObject( {
			attachment_id: image.id,
			available: true,
			mime_type: 'image/png',
			url: image.source_url,
			width: 40,
			height: 20,
		} );

		const combined = await createOk( id, {
			label: 'Instagram post',
			text: 'Caption',
			attachment_id: image.id,
		} );
		expect( combined.attachment_id ).toBe( image.id );

		// Core refuses a file that is not what it claims to be.
		const fake = await upload(
			`ma-fake-${ Date.now() }.png`,
			Buffer.from( '<?php echo 1;' ),
			'image/png'
		);
		expect( fake.res.ok() ).toBeFalsy();

		// A valid upload of another type is refused by the marketing route.
		const gifBytes = Buffer.from(
			'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
			'base64'
		);
		const { res: gifRes, body: gif } = await upload(
			`ma-${ Date.now() }.gif`,
			gifBytes,
			'image/gif'
		);
		expect( gifRes.ok() ).toBeTruthy();
		const refused = await create( id, {
			label: 'GIF',
			attachment_id: gif.id,
		} );
		expect( refused.status() ).toBe( 400 );
		expect( ( await refused.json() ).data.details.attachment_id.code ).toBe(
			'marketing_asset_attachment_type'
		);

		const unknown = await create( id, {
			label: 'Ghost',
			attachment_id: 99999999,
		} );
		expect( ( await unknown.json() ).data.details.attachment_id.code ).toBe(
			'marketing_asset_attachment_not_found'
		);

		// Unlinking keeps the attachment.
		const detached = await patch( id, combined.id, {
			attachment_id: null,
		} );
		expect( ( await detached.json() ).image ).toBeNull();
		const media = await api.get( `/wp-json/wp/v2/media/${ image.id }`, {
			headers: adminHeaders,
		} );
		expect( media.status() ).toBe( 200 );
	} );

	test( 'scopes team and schedule links to the event, including a series', async () => {
		const series = await createEvent( {
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		const [ first, second ] = series.occurrenceIds;
		expect( second ).toBeTruthy();
		const other = await createEvent();

		const onTeam = await createMember( `Ana ${ Date.now() }` );
		const elsewhere = await createMember( `Other ${ Date.now() }` );
		await linkMember( series.id, onTeam );
		await linkMember( other.id, elsewhere );

		const [ workshop ] = await saveSchedule( series.id, [ 'Acro' ] );
		const [ otherItem ] = await saveSchedule( other.id, [ 'Other' ] );

		const options = await (
			await api.get( `${ assetsPath( first ) }/options`, {
				headers: adminHeaders,
			} )
		).json();
		expect( options.team.available ).toBe( true );
		expect( options.team.members.map( ( m ) => m.id ) ).toEqual( [
			onTeam,
		] );
		expect( options.schedule.items.map( ( i ) => i.id ) ).toEqual( [
			workshop,
		] );
		// Picker data has names only.
		expect( Object.keys( options.team.members[ 0 ] ).sort() ).toEqual( [
			'id',
			'name',
			'surname',
		] );

		const asset = await createOk( first, {
			label: 'Instagram post',
			text: 'Week one',
			member_ids: [ onTeam ],
			schedule_item_id: workshop,
			publish_member_names: true,
		} );
		expect( asset.member_ids ).toEqual( [ onTeam ] );
		expect( asset.schedule_item ).toMatchObject( {
			id: workshop,
			title: 'Acro',
		} );

		// Another occurrence of the series starts with its own empty list.
		const sibling = await (
			await api.get( assetsPath( second ), { headers: adminHeaders } )
		).json();
		expect( sibling.total ).toBe( 0 );
		const crossRead = await read( second, asset.id );
		expect( crossRead.status() ).toBe( 404 );
		const crossPatch = await patch( second, asset.id, { text: 'x' } );
		expect( crossPatch.status() ).toBe( 404 );

		const badMember = await create( first, {
			label: 'X',
			text: 'Y',
			member_ids: [ elsewhere ],
			publish_member_names: true,
		} );
		expect( badMember.status() ).toBe( 400 );
		expect( ( await badMember.json() ).data.details.member_ids.code ).toBe(
			'marketing_asset_member_not_on_team'
		);

		const badItem = await create( first, {
			label: 'X',
			text: 'Y',
			schedule_item_id: otherItem,
		} );
		expect( badItem.status() ).toBe( 400 );
		expect(
			( await badItem.json() ).data.details.schedule_item_id.code
		).toBe( 'marketing_asset_schedule_item_not_found' );

		const teamPath = `${ EVENT_DATES_PATH }/${ series.id }/team-assignments`;
		const added = await api.post( teamPath, {
			headers: adminHeaders,
			data: { member_id: onTeam, role: 'teacher' },
		} );
		expect( added.status() ).toBe( 201 );
		const { assignments } = await added.json();
		const teacher = assignments.find(
			( entry ) => entry.role === 'teacher'
		);

		const programme = await api.post(
			`${ EVENT_DATES_PATH }/${ series.id }/schedule-items/${ workshop }/contributors`,
			{
				headers: adminHeaders,
				data: { member_id: onTeam, role: 'teacher' },
			}
		);
		expect( programme.status() ).toBe( 201 );

		await api.delete(
			`${ EVENT_DATES_PATH }/${ series.id }/team-members/${ onTeam }`,
			{ headers: adminHeaders }
		);
		const stillLinked = await ( await read( first, asset.id ) ).json();
		expect( stillLinked.member_ids ).toEqual( [ onTeam ] );

		const removed = await api.delete( `${ teamPath }/${ teacher.id }`, {
			headers: adminHeaders,
		} );
		expect( removed.status() ).toBe( 200 );
		const afterTeamRemoval = await ( await read( first, asset.id ) ).json();
		expect( afterTeamRemoval.member_ids ).toEqual( [] );
		const programmeOnly = await patch( first, asset.id, {
			member_ids: [ onTeam ],
			publish_member_names: true,
		} );
		expect( programmeOnly.status() ).toBe( 400 );

		await saveSchedule( series.id, [] );
		const after = await ( await read( first, asset.id ) ).json();
		expect( after ).toMatchObject( {
			label: 'Instagram post',
			text: 'Week one',
			member_ids: [],
			schedule_item_id: null,
		} );
		const stored = await evalJson(
			`global $wpdb; echo 'JSON:' . wp_json_encode( array( 'members' => (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE asset_id = %d', $wpdb->prefix . 'fair_events_marketing_asset_members', ${ Number(
				asset.id
			) } ) ), 'item' => $wpdb->get_var( $wpdb->prepare( 'SELECT schedule_item_id FROM %i WHERE id = %d', $wpdb->prefix . 'fair_events_marketing_assets', ${ Number(
				asset.id
			) } ) ) ) );`
		);
		expect( stored ).toEqual( { members: 0, item: null } );

		// Deleting an occurrence deletes its assets.
		await wp(
			'eval',
			`FairEvents\\Models\\EventDates::delete_by_id( ${ Number(
				first
			) } );`
		);
		const rows = await evalJson(
			`global $wpdb; echo 'JSON:' . (int) $wpdb->get_var( $wpdb->prepare( 'SELECT COUNT(*) FROM %i WHERE event_date_id = %d', $wpdb->prefix . 'fair_events_marketing_assets', ${ Number(
				first
			) } ) );`
		);
		expect( rows ).toBe( 0 );
	} );

	test( 'keeps links while team management is off and only allows removal', async () => {
		const { id } = await createEvent();
		const a = await createMember( `Keep ${ Date.now() }` );
		const b = await createMember( `New ${ Date.now() }` );
		await linkMember( id, a );
		await linkMember( id, b );
		const asset = await createOk( id, {
			label: 'Post',
			text: 'Team',
			member_ids: [ a ],
			publish_member_names: true,
		} );

		await setBundles( { 'marketing-assets': true, 'team-members': false } );
		try {
			const kept = await ( await read( id, asset.id ) ).json();
			expect( kept.member_ids ).toEqual( [ a ] );

			const options = await (
				await api.get( `${ assetsPath( id ) }/options`, {
					headers: adminHeaders,
				} )
			).json();
			expect( options.team.available ).toBe( false );

			const add = await patch( id, asset.id, {
				member_ids: [ a, b ],
				publish_member_names: true,
			} );
			expect( add.status() ).toBe( 409 );
			expect( ( await add.json() ).code ).toBe(
				'marketing_asset_team_unavailable'
			);

			const edit = await patch( id, asset.id, { text: 'Edited' } );
			expect( ( await edit.json() ).member_ids ).toEqual( [ a ] );

			const remove = await patch( id, asset.id, { member_ids: [] } );
			expect( ( await remove.json() ).member_ids ).toEqual( [] );
		} finally {
			await setBundles( {
				'marketing-assets': true,
				'team-members': true,
			} );
		}
	} );

	test( 'an image deleted from the Media Library leaves a repairable asset', async () => {
		const { id } = await createEvent();
		const { body: image } = await upload(
			`ma-del-${ Date.now() }.png`,
			png( 10, 10 ),
			'image/png'
		);
		const member = await createMember( `Img ${ Date.now() }` );
		await linkMember( id, member );
		const asset = await createOk( id, {
			label: 'WhatsApp status',
			attachment_id: image.id,
			member_ids: [ member ],
			publish_member_names: true,
		} );

		await wp( 'post', 'delete', String( image.id ), '--force' );

		const removed = await ( await read( id, asset.id ) ).json();
		expect( removed ).toMatchObject( {
			label: 'WhatsApp status',
			attachment_id: null,
			image: null,
			image_removed: true,
			member_ids: [ member ],
		} );

		const relabel = await patch( id, asset.id, { label: 'Status' } );
		expect( relabel.status() ).toBe( 400 );

		const repaired = await patch( id, asset.id, { text: 'Repaired' } );
		expect( repaired.status() ).toBe( 200 );
		expect( ( await repaired.json() ).image_removed ).toBe( false );
	} );

	test( 'direct image URLs follow the WordPress media lifecycle', async () => {
		const { id } = await createEvent();
		const { body: image } = await upload(
			`ma-url-${ Date.now() }.png`,
			png( 12, 12 ),
			'image/png'
		);
		const url = image.source_url;

		// Right after upload, before any publication.
		expect( await anonymousFileStatus( url ) ).toBe( 200 );

		const asset = await createOk( id, {
			label: 'Post',
			text: 'Hi',
			attachment_id: image.id,
		} );

		// Anonymous visitors cannot read the asset itself.
		const anonymous = await anon.get(
			`${ assetsPath( id ) }/${ asset.id }`
		);
		expect( anonymous.status() ).toBe( 401 );

		await patch( id, asset.id, { attachment_id: null } );
		expect( await anonymousFileStatus( url ) ).toBe( 200 );

		await patch( id, asset.id, { attachment_id: image.id } );
		await api.delete( `${ assetsPath( id ) }/${ asset.id }`, {
			headers: adminHeaders,
		} );
		expect( await anonymousFileStatus( url ) ).toBe( 200 );

		await setBundles( {
			'marketing-assets': false,
			'team-members': true,
		} );
		try {
			expect( await anonymousFileStatus( url ) ).toBe( 200 );
		} finally {
			await setBundles( {
				'marketing-assets': true,
				'team-members': true,
			} );
		}
	} );

	test( 'paginates and deletes', async () => {
		const { id } = await createEvent();
		const ids = [];
		for ( let i = 0; i < 3; i++ ) {
			ids.push(
				( await createOk( id, { label: `L${ i }`, text: `T${ i }` } ) )
					.id
			);
		}
		const page = await api.get( `${ assetsPath( id ) }?per_page=2&page=2`, {
			headers: adminHeaders,
		} );
		const body = await page.json();
		expect( body ).toMatchObject( {
			total: 3,
			page: 2,
			per_page: 2,
			total_pages: 2,
		} );
		expect( body.items.map( ( a ) => a.id ) ).toEqual( [ ids[ 2 ] ] );
		expect( page.headers()[ 'x-wp-total' ] ).toBe( '3' );

		const del = await api.delete( `${ assetsPath( id ) }/${ ids[ 0 ] }`, {
			headers: adminHeaders,
		} );
		expect( ( await del.json() ).previous.label ).toBe( 'L0' );
		expect( ( await read( id, ids[ 0 ] ) ).status() ).toBe( 404 );
	} );

	test( 'the bundle off hides every route and keeps stored assets', async () => {
		const { id } = await createEvent();
		const asset = await createOk( id, {
			label: 'Kept',
			text: 'Still here',
		} );

		await setBundles( {
			'marketing-assets': false,
			'team-members': true,
		} );
		try {
			for ( const res of [
				await api.get( assetsPath( id ), { headers: adminHeaders } ),
				await api.get( `${ assetsPath( id ) }/options`, {
					headers: adminHeaders,
				} ),
				await create( id, { label: 'X', text: 'Y' } ),
				await read( id, asset.id ),
			] ) {
				expect( res.status() ).toBe( 404 );
				expect( ( await res.json() ).code ).toBe( 'rest_no_route' );
			}
		} finally {
			await setBundles( {
				'marketing-assets': true,
				'team-members': true,
			} );
		}

		const back = await ( await read( id, asset.id ) ).json();
		expect( back ).toMatchObject( { label: 'Kept', text: 'Still here' } );
	} );
} );
