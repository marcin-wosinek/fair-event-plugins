/**
 * Playwright API tests for public marketing asset sharing (#2430):
 * PublicMarketingAssetsController (`/fair-events/v1/marketing-assets`) and
 * the public pages (`?fair_marketing_assets=all|{id}`).
 *
 * Covers anonymous discovery and access for draft, private, published and
 * series occurrences through publication changes, without exposing the
 * event's own data; the public field list; the publication confirmation
 * for member names, links saved before it (including a real schema
 * upgrade), association removal and profile-name edits; label and member
 * filters; caching and indexing headers; direct image URLs around
 * publication changes; and all four combinations of the
 * `marketing-assets` and `team-members` bundles.
 *
 * The suite removes the events, posts, profiles and attachments it
 * creates, and leaves both bundles off (their default).
 */

import { test, expect, request } from '@playwright/test';
import { png } from '../../../../e2e/support/png.js';
import {
	BASE_URL,
	EVENT_DATES_PATH,
	adminHeaders,
	assetsPath,
	evalJson,
	setBundles,
	wp,
} from './helpers/marketing-fixtures.js';

const PUBLIC_PATH = '/wp-json/fair-events/v1/marketing-assets';
const MEMBERS_TABLE = 'fair_events_marketing_asset_members';
const EXACT_TEXT =
	'  Ven al taller 🎉\r\n\tPlazas: 20  \n\nCafé 👩‍👩‍👧 <b>not bold</b> &amp;\n  ';

const PRIVATE_PROFILE = {
	email: 'private-2430@example.com',
	phone: '+34 600 000 430',
	instagram: 'private.handle.2430',
	facebook_url: 'https://www.facebook.com/private2430',
	website_url: 'https://private-2430.example',
	bio: 'Private bio 2430',
};

test.describe( 'PublicMarketingAssetsController', () => {
	test.describe.configure( { mode: 'serial' } );

	let api;
	let anon;
	const eventDateIds = [];
	const postIds = [];
	const memberIds = [];
	const attachmentIds = [];

	const createEvent = async ( { title, rrule } = {} ) => {
		const res = await api.post( EVENT_DATES_PATH, {
			headers: adminHeaders,
			data: {
				title: title || `Public marketing ${ Date.now() }`,
				start_date: '2035-11-07',
				start_time: '18:00:00',
				end_date: '2035-11-07',
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

	const setPublication = async ( id, status ) => {
		const res = await api.post(
			`${ EVENT_DATES_PATH }/${ id }/publication-status`,
			{ headers: adminHeaders, data: { publication_status: status } }
		);
		expect( res.ok(), await res.text() ).toBeTruthy();
	};

	const createMember = async ( name, surname = 'Test', extra = {} ) => {
		const res = await api.post( '/wp-json/fair-events/v1/team-members', {
			headers: adminHeaders,
			data: { name, surname, ...extra },
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

	const createAsset = async ( eventDateId, data ) => {
		const res = await api.post( assetsPath( eventDateId ), {
			headers: adminHeaders,
			data,
		} );
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 201 );
		return body;
	};

	const patchAsset = ( eventDateId, id, data ) =>
		api.patch( `${ assetsPath( eventDateId ) }/${ id }`, {
			headers: adminHeaders,
			data,
		} );

	const publicList = async ( eventDateId, query = '' ) => {
		const res = await anon.get(
			`${ PUBLIC_PATH }/${ eventDateId }?per_page=100${ query }`
		);
		const body = await res.json();
		expect( res.status(), JSON.stringify( body ) ).toBe( 200 );
		return body;
	};

	const names = ( members ) =>
		members.map( ( m ) => `${ m.name } ${ m.surname }` ).sort();

	const upload = async ( name ) => {
		const res = await api.post( '/wp-json/wp/v2/media', {
			headers: {
				...adminHeaders,
				'Content-Type': 'image/png',
				'Content-Disposition': `attachment; filename="${ name }"`,
			},
			data: png( 8, 8 ),
		} );
		const body = await res.json();
		expect( res.ok(), JSON.stringify( body ) ).toBeTruthy();
		attachmentIds.push( body.id );
		return body;
	};

	const anonymousFileStatus = async ( url ) => {
		const res = await anon.get(
			`${ new URL( url ).pathname }?nocache=${ Date.now() }`,
			{ headers: { 'Cache-Control': 'no-cache' } }
		);
		return res.status();
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		anon = await request.newContext( { baseURL: BASE_URL } );
		await setBundles( {
			'marketing-assets': true,
			'team-members': true,
		} );
	} );

	test.afterAll( async () => {
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
		for ( const id of [ ...postIds, ...attachmentIds ] ) {
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
		await api.dispose();
		await anon.dispose();
	} );

	test( 'every occurrence is discoverable whatever its publication status', async () => {
		const publishedTitle = `Published 2430 ${ Date.now() }`;
		const draftTitle = `Secret draft 2430 ${ Date.now() }`;
		const privateTitle = `Private page 2430 ${ Date.now() }`;

		const published = await createEvent( { title: publishedTitle } );
		const draft = await createEvent( { title: draftTitle } );
		await setPublication( draft.id, 'draft' );
		const series = await createEvent( {
			title: `Series 2430 ${ Date.now() }`,
			rrule: 'FREQ=WEEKLY;COUNT=3',
		} );
		const [ first, second ] = series.occurrenceIds;

		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: privateTitle, status: 'private' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		const postId = ( await postRes.json() ).id;
		postIds.push( postId );
		const linked = await createEvent( { title: privateTitle } );
		const linkRes = await api.put( `${ EVENT_DATES_PATH }/${ linked.id }`, {
			headers: adminHeaders,
			data: { link_type: 'post', event_id: postId },
		} );
		expect( linkRes.ok(), await linkRes.text() ).toBeTruthy();

		await createAsset( draft.id, {
			label: 'Instagram post',
			text: 'Before the announcement',
		} );
		await createAsset( first, { label: 'Status', text: 'Week one' } );

		// Discovery lists every one of them, newest first.
		const discovery = await anon.get( `${ PUBLIC_PATH }?per_page=100` );
		expect( discovery.status() ).toBe( 200 );
		expect( discovery.headers()[ 'cache-control' ] ).toContain(
			'no-store'
		);
		expect( discovery.headers()[ 'x-robots-tag' ] ).toBe( 'noindex' );
		const entries = ( await discovery.json() ).items;
		const entry = ( id ) => entries.find( ( e ) => e.event_date_id === id );
		expect( entry( published.id ) ).toEqual( {
			event_date_id: published.id,
			title: publishedTitle,
			url: expect.stringContaining(
				`fair_marketing_assets=${ published.id }`
			),
		} );
		// Unpublished events are listed by ID only.
		expect( entry( draft.id ).title ).toBeNull();
		expect( entry( linked.id ).title ).toBeNull();
		expect( entry( first ) ).toBeTruthy();
		expect( entry( second ) ).toBeTruthy();
		expect( JSON.stringify( entries ) ).not.toContain( draftTitle );
		expect( JSON.stringify( entries ) ).not.toContain( privateTitle );

		// Each page and its assets open anonymously, empty ones included.
		for ( const id of [ published.id, draft.id, linked.id, second ] ) {
			const page = await anon.get( `/?fair_marketing_assets=${ id }` );
			expect( page.status() ).toBe( 200 );
			const html = await page.text();
			expect( html ).toContain( `data-event-date-id="${ id }"` );
			expect( html ).toMatch( /<meta name=['"]robots['"][^>]*noindex/ );
			expect( page.headers()[ 'cache-control' ] ).toContain( 'no-store' );
			expect( html ).not.toContain( draftTitle );
			expect( html ).not.toContain( privateTitle );
		}
		expect(
			await (
				await anon.get( `/?fair_marketing_assets=${ published.id }` )
			).text()
		).toContain( publishedTitle );

		const draftAssets = await publicList( draft.id );
		expect( draftAssets ).toMatchObject( { title: null, total: 1 } );
		expect( draftAssets.items[ 0 ].text ).toBe( 'Before the announcement' );
		expect( ( await publicList( second ) ).total ).toBe( 0 );
		expect( ( await publicList( first ) ).total ).toBe( 1 );

		const index = await anon.get( '/?fair_marketing_assets=all' );
		expect( index.status() ).toBe( 200 );
		expect( await index.text() ).toContain( 'data-view="index"' );

		// Publishing names the event; drafting it again keeps the page.
		await setPublication( draft.id, 'publish' );
		expect( ( await publicList( draft.id ) ).title ).toBe( draftTitle );
		await setPublication( draft.id, 'draft' );
		const again = await publicList( draft.id );
		expect( again ).toMatchObject( { title: null, total: 1 } );

		// The event itself stays unpublished.
		const facts = await anon.get(
			`${ EVENT_DATES_PATH }/${ draft.id }/public-campaign-facts`
		);
		expect( facts.status() ).toBe( 404 );
		const eventRead = await anon.get(
			`${ EVENT_DATES_PATH }/${ draft.id }`
		);
		expect( eventRead.status() ).toBeGreaterThanOrEqual( 401 );

		// A missing occurrence is a 404 on both.
		const missing = await anon.get( `${ PUBLIC_PATH }/99999999` );
		expect( missing.status() ).toBe( 404 );
		expect( ( await missing.json() ).code ).toBe(
			'rest_event_date_not_found'
		);
		const missingPage = await anon.get(
			'/?fair_marketing_assets=99999999'
		);
		expect( missingPage.status() ).toBe( 404 );
	} );

	test( 'public responses carry only asset content and published names', async () => {
		const { id } = await createEvent();
		const ana = await createMember(
			`Ana${ Date.now() }`,
			'Ruiz',
			PRIVATE_PROFILE
		);
		const bo = await createMember( `Bo${ Date.now() }`, '' );
		const twinA = await createMember( 'Twin', 'Same' );
		const twinB = await createMember( 'Twin', 'Same' );
		const teamOnly = await createMember( `TeamOnly${ Date.now() }` );
		const profileOnly = await createMember( `ProfileOnly${ Date.now() }` );
		for ( const member of [ ana, bo, twinA, twinB, teamOnly ] ) {
			await linkMember( id, member );
		}
		const image = await upload( `pub-${ Date.now() }.png` );

		const post = await createAsset( id, {
			label: 'Instagram post',
			text: EXACT_TEXT,
			attachment_id: image.id,
			member_ids: [ ana ],
			publish_member_names: true,
		} );
		const status = await createAsset( id, {
			label: 'WhatsApp status',
			text: 'Status',
			member_ids: [ bo, twinA, twinB ],
			publish_member_names: true,
		} );
		await createAsset( id, { label: 'WhatsApp status', text: 'No team' } );

		const body = await publicList( id );
		expect( body.total ).toBe( 3 );
		const [ first ] = body.items;
		expect( Object.keys( first ).sort() ).toEqual( [
			'id',
			'image',
			'image_unavailable',
			'label',
			'members',
			'text',
		] );
		expect( first.text ).toBe( EXACT_TEXT );
		expect( Object.keys( first.image ).sort() ).toEqual( [
			'alt',
			'mime_type',
			'url',
		] );
		expect( first.image ).toMatchObject( {
			url: image.source_url,
			mime_type: 'image/png',
		} );
		expect( Object.keys( first.members[ 0 ] ).sort() ).toEqual( [
			'key',
			'name',
			'surname',
		] );
		expect( body.filters.labels ).toEqual( [
			'Instagram post',
			'WhatsApp status',
		] );

		// Filters offer exactly the members with a published link: not
		// the team-only member, nor a profile on no team.
		const anaName = body.items[ 0 ].members[ 0 ].name;
		const boName = body.items[ 1 ].members.find(
			( m ) => 'Twin' !== m.name
		).name;
		expect( names( body.filters.members ) ).toEqual(
			[
				`${ anaName } Ruiz`,
				`${ boName } `,
				'Twin Same',
				'Twin Same',
			].sort()
		);
		expect( body.filters.members ).toHaveLength( 4 );
		const twins = body.filters.members.filter( ( m ) => m.name === 'Twin' );
		expect( twins ).toHaveLength( 2 );
		expect( twins[ 0 ].key ).not.toBe( twins[ 1 ].key );

		// Nothing private, no profile IDs, nothing of the schedule or file.
		const raw = JSON.stringify( body );
		for ( const value of Object.values( PRIVATE_PROFILE ) ) {
			expect( raw ).not.toContain( value );
		}
		for ( const field of [
			'member_id',
			'attachment_id',
			'schedule_item',
			'email',
			'phone',
			'gender',
		] ) {
			expect( raw ).not.toContain( `"${ field }` );
		}
		expect( raw ).not.toContain( 'TeamOnly' );
		expect( raw ).not.toContain( 'ProfileOnly' );
		expect( profileOnly ).toBeTruthy();

		// Filtering by member includes assets shared with others.
		const anaKey = first.members[ 0 ].key;
		const byAna = await publicList( id, `&member=${ anaKey }` );
		expect( byAna.items.map( ( a ) => a.id ) ).toEqual( [ post.id ] );
		const byTwin = await publicList( id, `&member=${ twins[ 1 ].key }` );
		expect( byTwin.items.map( ( a ) => a.id ) ).toEqual( [ status.id ] );
		const byLabel = await publicList(
			id,
			`&label=${ encodeURIComponent( 'WhatsApp status' ) }`
		);
		expect( byLabel.total ).toBe( 2 );
		const both = await publicList(
			id,
			`&label=${ encodeURIComponent( 'WhatsApp status' ) }&member=${ anaKey }`
		);
		expect( both.total ).toBe( 0 );
		expect(
			( await publicList( id, '&member=0000000000000000' ) ).total
		).toBe( 0 );
		const badKey = await anon.get(
			`${ PUBLIC_PATH }/${ id }?member=${ ana }`
		);
		expect( badKey.status() ).toBe( 400 );
		// Keys are scoped to the occurrence.
		const other = await createEvent();
		await linkMember( other.id, ana );
		await createAsset( other.id, {
			label: 'Post',
			text: 'Elsewhere',
			member_ids: [ ana ],
			publish_member_names: true,
		} );
		const otherKey = ( await publicList( other.id ) ).filters.members[ 0 ]
			.key;
		expect( otherKey ).not.toBe( anaKey );

		// A profile edit shows on the next read.
		const edit = await api.put(
			`/wp-json/fair-events/v1/team-members/${ ana }`,
			{ headers: adminHeaders, data: { name: 'Anabel', surname: 'Ruiz' } }
		);
		expect( edit.ok(), await edit.text() ).toBeTruthy();
		const renamed = await publicList( id, `&member=${ anaKey }` );
		expect( renamed.items[ 0 ].members[ 0 ] ).toMatchObject( {
			name: 'Anabel',
			surname: 'Ruiz',
		} );

		// Removing a link removes the name and, once unused, its filter.
		const unlinked = await patchAsset( id, status.id, {
			member_ids: [ twinA, twinB ],
		} );
		expect( unlinked.status() ).toBe( 200 );
		const after = await publicList( id );
		expect(
			after.filters.members.some( ( m ) => m.name.startsWith( 'Bo' ) )
		).toBe( false );
		expect( JSON.stringify( after ) ).not.toContain( boName );
		const statusAfter = after.items.find( ( a ) => a.id === status.id );
		expect( statusAfter.members.map( ( m ) => m.name ) ).toEqual( [
			'Twin',
			'Twin',
		] );

		// So does unlinking the member from the event's team.
		await api.delete(
			`${ EVENT_DATES_PATH }/${ id }/team-members/${ twinA }`,
			{
				headers: adminHeaders,
			}
		);
		expect(
			( await publicList( id ) ).filters.members.filter(
				( m ) => m.name === 'Twin'
			)
		).toHaveLength( 1 );

		// A deleted image reads as unavailable.
		await wp( 'post', 'delete', String( image.id ), '--force' );
		const noImage = ( await publicList( id ) ).items.find(
			( a ) => a.id === post.id
		);
		expect( noImage ).toMatchObject( {
			image: null,
			image_unavailable: true,
		} );
	} );

	test( 'member names need an explicit, recorded confirmation', async () => {
		const { id } = await createEvent();
		const ana = await createMember( `Confirm${ Date.now() }` );
		await linkMember( id, ana );

		const unconfirmed = await api.post( assetsPath( id ), {
			headers: adminHeaders,
			data: { label: 'Post', text: 'Hi', member_ids: [ ana ] },
		} );
		expect( unconfirmed.status() ).toBe( 400 );
		expect(
			( await unconfirmed.json() ).data.details.member_ids.code
		).toBe( 'marketing_asset_publication_unconfirmed' );

		const asset = await createAsset( id, {
			label: 'Post',
			text: 'Hi',
			member_ids: [ ana ],
			publish_member_names: true,
		} );
		expect( asset.members[ 0 ].public ).toBe( true );

		const withoutList = await patchAsset( id, asset.id, {
			publish_member_names: true,
		} );
		expect( withoutList.status() ).toBe( 400 );
		expect(
			( await withoutList.json() ).data.details.member_ids.code
		).toBe( 'marketing_asset_publication_needs_members' );

		// A link saved before the confirmation existed stays private.
		await wp(
			'eval',
			`global $wpdb; $wpdb->update( $wpdb->prefix . '${ MEMBERS_TABLE }', array( 'disclosure_version' => 0 ), array( 'asset_id' => ${ Number(
				asset.id
			) } ) );`
		);
		expect( ( await publicList( id ) ).filters.members ).toEqual( [] );
		expect( ( await publicList( id ) ).items[ 0 ].members ).toEqual( [] );

		const edited = await patchAsset( id, asset.id, { text: 'Edited' } );
		const editedBody = await edited.json();
		expect( editedBody.members[ 0 ] ).toMatchObject( {
			id: ana,
			public: false,
		} );
		expect( ( await publicList( id ) ).filters.members ).toEqual( [] );

		const approved = await patchAsset( id, asset.id, {
			member_ids: [ ana ],
			publish_member_names: true,
		} );
		expect( ( await approved.json() ).members[ 0 ].public ).toBe( true );
		expect( ( await publicList( id ) ).filters.members ).toHaveLength( 1 );
		const stored = await evalJson(
			`global $wpdb; echo 'JSON:' . (int) $wpdb->get_var( $wpdb->prepare( 'SELECT disclosure_version FROM %i WHERE asset_id = %d', $wpdb->prefix . '${ MEMBERS_TABLE }', ${ Number(
				asset.id
			) } ) );`
		);
		expect( stored ).toBe( 1 );
	} );

	test( 'upgrading keeps every earlier link private', async () => {
		const { id } = await createEvent();
		const ana = await createMember( `Upgrade${ Date.now() }` );
		await linkMember( id, ana );
		const asset = await createAsset( id, {
			label: 'Post',
			text: 'Legacy',
			member_ids: [ ana ],
			publish_member_names: true,
		} );

		// Back to the #2396 schema, then let the next request upgrade it.
		await wp(
			'eval',
			`global $wpdb; $wpdb->query( $wpdb->prepare( 'ALTER TABLE %i DROP COLUMN disclosure_version', $wpdb->prefix . '${ MEMBERS_TABLE }' ) ); update_option( FairEventsExperimental\\Models\\MarketingAssetRepository::DB_VERSION_OPTION, '1' );`
		);
		const upgraded = await publicList( id );
		expect( upgraded.items[ 0 ].text ).toBe( 'Legacy' );
		expect( upgraded.items[ 0 ].members ).toEqual( [] );
		const admin = await (
			await api.get( `${ assetsPath( id ) }/${ asset.id }`, {
				headers: adminHeaders,
			} )
		).json();
		expect( admin.member_ids ).toEqual( [ ana ] );
		expect( admin.members[ 0 ].public ).toBe( false );
	} );

	test( 'direct image URLs stay reachable around publication changes', async () => {
		const { id } = await createEvent();
		await setPublication( id, 'draft' );
		const image = await upload( `pub-url-${ Date.now() }.png` );
		expect( await anonymousFileStatus( image.source_url ) ).toBe( 200 );

		await createAsset( id, { label: 'Poster', attachment_id: image.id } );
		const shared = await publicList( id );
		expect( shared.items[ 0 ].image.url ).toBe( image.source_url );
		expect( await anonymousFileStatus( image.source_url ) ).toBe( 200 );

		await setPublication( id, 'publish' );
		expect( await anonymousFileStatus( image.source_url ) ).toBe( 200 );
		await setPublication( id, 'draft' );
		expect( await anonymousFileStatus( image.source_url ) ).toBe( 200 );
	} );

	test( 'the marketing and directory bundles combine as documented', async () => {
		const { id } = await createEvent();
		const kept = await createMember( `Kept${ Date.now() }` );
		const added = await createMember( `Added${ Date.now() }` );
		await linkMember( id, kept );
		await linkMember( id, added );
		const asset = await createAsset( id, {
			label: 'Post',
			text: 'Matrix',
			member_ids: [ kept ],
			publish_member_names: true,
		} );

		const check = async ( { marketing, directory } ) => {
			await setBundles( {
				'marketing-assets': marketing,
				'team-members': directory,
			} );

			const publicRes = await anon.get( `${ PUBLIC_PATH }/${ id }` );
			const page = await anon.get( `/?fair_marketing_assets=${ id }` );
			const indexPage = await anon.get( '/?fair_marketing_assets=all' );
			const manage = await api.get( assetsPath( id ), {
				headers: adminHeaders,
			} );
			const directoryRes = await api.get(
				`/wp-json/fair-events/v1/team-members/${ kept }`,
				{ headers: adminHeaders }
			);

			expect( directoryRes.status() ).toBe( directory ? 200 : 404 );
			if ( ! marketing ) {
				expect( publicRes.status() ).toBe( 404 );
				expect( ( await publicRes.json() ).code ).toBe(
					'rest_no_route'
				);
				expect( page.status() ).toBe( 404 );
				expect( await page.text() ).not.toContain(
					'fair-marketing-assets__app'
				);
				expect( indexPage.status() ).toBe( 404 );
				expect( manage.status() ).toBe( 404 );
				return;
			}

			expect( publicRes.status() ).toBe( 200 );
			expect( page.status() ).toBe( 200 );
			expect( indexPage.status() ).toBe( 200 );
			const body = await publicRes.json();
			// Published names and filters stay with the directory off.
			expect( body.items[ 0 ].text ).toBe( 'Matrix' );
			expect( body.filters.members.map( ( m ) => m.name ) ).toEqual( [
				expect.stringMatching( /^Kept/ ),
			] );
			expect( manage.status() ).toBe( 200 );
		};

		await check( { marketing: false, directory: false } );
		await check( { marketing: false, directory: true } );

		await check( { marketing: true, directory: false } );
		// Marketing only: content edits and removals, no additions.
		const addition = await patchAsset( id, asset.id, {
			member_ids: [ kept, added ],
			publish_member_names: true,
		} );
		expect( addition.status() ).toBe( 409 );
		const swap = await patchAsset( id, asset.id, {
			member_ids: [ added ],
			publish_member_names: true,
		} );
		expect( swap.status() ).toBe( 409 );
		const content = await patchAsset( id, asset.id, { text: 'Matrix' } );
		expect( content.status() ).toBe( 200 );
		expect( ( await content.json() ).member_ids ).toEqual( [ kept ] );
		const options = await (
			await api.get( `${ assetsPath( id ) }/options`, {
				headers: adminHeaders,
			} )
		).json();
		expect( options.team ).toEqual( { available: false, members: [] } );

		await check( { marketing: true, directory: true } );

		// Removal works with the directory off, and is public at once.
		await setBundles( { 'marketing-assets': true, 'team-members': false } );
		const removed = await patchAsset( id, asset.id, { member_ids: [] } );
		expect( removed.status() ).toBe( 200 );
		expect( ( await publicList( id ) ).filters.members ).toEqual( [] );

		// Turning marketing off and on keeps the assets.
		await setBundles( { 'marketing-assets': false, 'team-members': true } );
		await setBundles( { 'marketing-assets': true, 'team-members': true } );
		const back = await publicList( id );
		expect( back.items.map( ( a ) => a.id ) ).toEqual( [ asset.id ] );
	} );
} );
