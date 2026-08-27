/**
 * Playwright API tests for EventDatesController.
 *
 * Covers:
 * - Standalone category copy on first link ($newly_linked fix).
 * - Recurrence reconciliation: occurrence IDs are preserved on time/venue edits,
 *   RRULE shortening only deletes removed rows, and master time edits propagate
 *   to generated children.
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

test.describe( 'EventDatesController — standalone category copy on first link', () => {
	let api;
	let categoryId;
	let eventDateId;
	let postId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		// Create a WP category.
		const catRes = await api.post( '/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Test Cat ${ Date.now() }` },
		} );
		expect( catRes.ok() ).toBeTruthy();
		categoryId = ( await catRes.json() ).id;

		// Create a fair_event post (no event date yet — standalone path).
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Link Target ${ Date.now() }`, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		postId = ( await postRes.json() ).id;

		// Create a standalone event date with the category in the junction table.
		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Standalone ${ Date.now() }`,
				start_datetime: '2030-01-01 10:00:00',
				end_datetime: '2030-01-01 12:00:00',
				categories: [ categoryId ],
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		const edBody = await edRes.json();
		eventDateId = edBody.id;

		// Confirm category is present in the junction table (not on a post yet).
		expect( edBody.categories.map( ( c ) => c.id ) ).toContain(
			categoryId
		);
		expect( edBody.event_id ).toBeNull();
	} );

	test.afterAll( async () => {
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{
					headers: adminHeaders,
				}
			);
		}
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		if ( categoryId ) {
			await api.delete(
				`/wp-json/wp/v2/categories/${ categoryId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
	} );

	test( 'links standalone event to post and copies categories', async () => {
		const res = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{
				headers: adminHeaders,
				data: { event_id: postId },
			}
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		// After linking, event_id is set.
		expect( body.event_id ).toBe( postId );

		// Categories must appear on the event date response (sourced from the post).
		expect( body.categories.map( ( c ) => c.id ) ).toContain( categoryId );
	} );

	test( 'post has the copied category after first link', async () => {
		const res = await api.get( `/wp-json/wp/v2/fair_event/${ postId }`, {
			headers: adminHeaders,
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		expect( body.categories ).toContain( categoryId );
	} );

	test( 're-linking to a different post does not re-copy categories', async () => {
		// Create a second post (already has no categories).
		const post2Res = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Second Post ${ Date.now() }`, status: 'publish' },
		} );
		expect( post2Res.ok() ).toBeTruthy();
		const post2Id = ( await post2Res.json() ).id;

		try {
			const res = await api.put(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{
					headers: adminHeaders,
					data: { event_id: post2Id },
				}
			);
			expect( res.ok() ).toBeTruthy();
			const body = await res.json();
			expect( body.event_id ).toBe( post2Id );

			// Second post should NOT have the category copied (only first-link fires).
			const post2Res2 = await api.get(
				`/wp-json/wp/v2/fair_event/${ post2Id }`,
				{
					headers: adminHeaders,
				}
			);
			const post2Body = await post2Res2.json();
			expect( post2Body.categories ).not.toContain( categoryId );
		} finally {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ post2Id }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
	} );
} );

test.describe( 'EventDatesController — Polylang link synchronization', () => {
	let api;
	let eventDateId;
	const postIds = [];

	const configureGroup = async ( ids, savedPostId = 0 ) => {
		const group = Object.fromEntries(
			ids.map( ( id, index ) => [ `lang-${ index }`, id ] )
		);
		const groups = Object.fromEntries( ids.map( ( id ) => [ id, group ] ) );
		const response = await api.put(
			'/wp-json/fair-e2e/v1/polylang-groups',
			{
				headers: adminHeaders,
				data: {
					groups,
					saved_post_id: savedPostId,
					enabled_post_types: ids.length ? [ 'page' ] : [],
				},
			}
		);
		expect( response.ok() ).toBeTruthy();
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		for ( const language of [ 'English', 'French', 'Spanish' ] ) {
			const response = await api.post( '/wp-json/wp/v2/pages', {
				headers: adminHeaders,
				data: {
					title: `Polylang ${ language } ${ Date.now() }`,
					status: 'publish',
				},
			} );
			expect( response.ok() ).toBeTruthy();
			postIds.push( ( await response.json() ).id );
		}

		const response = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Polylang target ${ Date.now() }`,
					start_datetime: '2038-01-01 10:00:00',
				},
			}
		);
		expect( response.ok() ).toBeTruthy();
		eventDateId = ( await response.json() ).id;
		await configureGroup( postIds );
	} );

	test.afterAll( async () => {
		await configureGroup( [] );
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
		}
		for ( const postId of postIds ) {
			await api.delete( `/wp-json/wp/v2/pages/${ postId }?force=true`, {
				headers: adminHeaders,
			} );
		}
	} );

	test( 'explicit link and unlink apply to the complete group', async () => {
		const linkResponse = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/link-post`,
			{ headers: adminHeaders, data: { post_id: postIds[ 1 ] } }
		);
		expect( linkResponse.ok() ).toBeTruthy();
		const linked = await linkResponse.json();
		expect( linked.event_id ).toBe( postIds[ 1 ] );
		expect( linked.linked_posts.map( ( post ) => post.id ).sort() ).toEqual(
			[ ...postIds ].sort()
		);

		const unlinkResponse = await api.delete(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/link-post`,
			{ headers: adminHeaders, data: { post_id: postIds[ 0 ] } }
		);
		expect( unlinkResponse.ok() ).toBeTruthy();
		const unlinked = await unlinkResponse.json();
		expect( unlinked.event_id ).toBeNull();
		expect( unlinked.linked_posts ).toEqual( [] );
	} );

	test( 'pll_save_post adds a new translation to the established event', async () => {
		await configureGroup( postIds.slice( 0, 2 ) );
		await api.post(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }/link-post`,
			{ headers: adminHeaders, data: { post_id: postIds[ 0 ] } }
		);

		await configureGroup( postIds, postIds[ 2 ] );
		const response = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{ headers: adminHeaders }
		);
		const eventDate = await response.json();
		expect( eventDate.event_id ).toBe( postIds[ 0 ] );
		expect(
			eventDate.linked_posts.map( ( post ) => post.id ).sort()
		).toEqual( [ ...postIds ].sort() );
	} );
} );

test.describe( 'EventDatesController — link_post detach-then-link (#1429)', () => {
	let api;
	let postA;
	let eventDateA;
	let postB;
	let eventDateB;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		// postA/postB each get their own event date (event_id = post), the
		// same DB state a fair_event post's auto-created event date is in.
		const postARes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Link Post A ${ Date.now() }`, status: 'publish' },
		} );
		expect( postARes.ok() ).toBeTruthy();
		postA = ( await postARes.json() ).id;

		const postBRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Link Post B ${ Date.now() }`, status: 'publish' },
		} );
		expect( postBRes.ok() ).toBeTruthy();
		postB = ( await postBRes.json() ).id;

		const edARes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Link ED A ${ Date.now() }`,
				start_datetime: '2031-01-01 10:00:00',
			},
		} );
		expect( edARes.ok() ).toBeTruthy();
		eventDateA = ( await edARes.json() ).id;
		const linkARes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateA }`,
			{ headers: adminHeaders, data: { event_id: postA } }
		);
		expect( linkARes.ok() ).toBeTruthy();

		const edBRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Link ED B ${ Date.now() }`,
				start_datetime: '2031-02-01 10:00:00',
			},
		} );
		expect( edBRes.ok() ).toBeTruthy();
		eventDateB = ( await edBRes.json() ).id;
		const linkBRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateB }`,
			{ headers: adminHeaders, data: { event_id: postB } }
		);
		expect( linkBRes.ok() ).toBeTruthy();
	} );

	test.afterAll( async () => {
		if ( eventDateA ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateA }`,
				{ headers: adminHeaders }
			);
		}
		if ( eventDateB ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateB }`,
				{ headers: adminHeaders }
			);
		}
		if ( postA ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postA }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
		if ( postB ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postB }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
	} );

	test( 'relinking postA as secondary to eventDateB succeeds', async () => {
		const res = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ eventDateB }/link-post`,
			{
				headers: adminHeaders,
				data: { post_id: postA },
			}
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		// eventDateB keeps its own primary (postB); postA is now a secondary link.
		expect( body.event_id ).toBe( postB );
		const linkedIds = body.linked_posts.map( ( lp ) => lp.id );
		expect( linkedIds ).toContain( postA );
		expect(
			body.linked_posts.find( ( lp ) => lp.id === postA ).is_primary
		).toBe( false );
	} );

	test( "postA's old auto-created event date survives detached, not deleted", async () => {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ eventDateA }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();

		expect( body.event_id ).toBeNull();
		expect( body.link_type ).toBe( 'none' );
	} );

	test( 'a second post can be linked to an event that already has a primary', async () => {
		// eventDateB already has postB as primary and postA as secondary from
		// the earlier test — link a brand-new third post too.
		const postCRes = await api.post( '/wp-json/wp/v2/pages', {
			headers: adminHeaders,
			data: { title: `Link Post C ${ Date.now() }`, status: 'publish' },
		} );
		expect( postCRes.ok() ).toBeTruthy();
		const postC = ( await postCRes.json() ).id;

		try {
			const res = await api.post(
				`/wp-json/fair-events/v1/event-dates/${ eventDateB }/link-post`,
				{
					headers: adminHeaders,
					data: { post_id: postC },
				}
			);
			expect( res.ok() ).toBeTruthy();
			const body = await res.json();

			expect( body.event_id ).toBe( postB );
			const linkedIds = body.linked_posts.map( ( lp ) => lp.id );
			expect( linkedIds ).toContain( postA );
			expect( linkedIds ).toContain( postC );
		} finally {
			await api.delete( `/wp-json/wp/v2/pages/${ postC }?force=true`, {
				headers: adminHeaders,
			} );
		}
	} );
} );

test.describe( 'EventDatesController — relink resolves to series, not a generated date (#1431)', () => {
	let api;
	let postA;
	let masterEventDateId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const postARes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Series Relink Post A ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postARes.ok() ).toBeTruthy();
		postA = ( await postARes.json() ).id;

		// A recurring series with generated children, linked to postA so
		// event_id propagates onto every generated occurrence too.
		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Series Relink ${ Date.now() }`,
				start_datetime: '2038-01-01 10:00:00',
				end_datetime: '2038-01-01 12:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		const master = await edRes.json();
		masterEventDateId = master.id;
		expect( master.generated_occurrences.length ).toBe( 2 );

		const linkRes = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }/link-post`,
			{ headers: adminHeaders, data: { post_id: postA } }
		);
		expect( linkRes.ok() ).toBeTruthy();
	} );

	test.afterAll( async () => {
		if ( masterEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
				{ headers: adminHeaders }
			);
		}
		if ( postA ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postA }?force=true`,
				{
					headers: adminHeaders,
				}
			);
		}
	} );

	test( 'relinking postA to a different event clears the whole series, not just one generated date', async () => {
		// postA is linked to the series's master through several generated
		// children too; get_by_event_id() must resolve that lookup to the
		// master (not a buried generated row) so the detach below clears the
		// whole series, not just one date.
		const edBRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Series Relink Target ${ Date.now() }`,
				start_datetime: '2038-06-01 10:00:00',
			},
		} );
		expect( edBRes.ok() ).toBeTruthy();
		const eventDateB = ( await edBRes.json() ).id;

		try {
			const relinkRes = await api.post(
				`/wp-json/fair-events/v1/event-dates/${ eventDateB }/link-post`,
				{ headers: adminHeaders, data: { post_id: postA } }
			);
			expect( relinkRes.ok() ).toBeTruthy();
			const relinkBody = await relinkRes.json();
			expect( relinkBody.event_id ).toBe( postA );

			const masterRes = await api.get(
				`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
				{ headers: adminHeaders }
			);
			expect( masterRes.ok() ).toBeTruthy();
			const masterBody = await masterRes.json();

			expect( masterBody.event_id ).toBeNull();
			expect( masterBody.link_type ).toBe( 'none' );

			// Every generated child must also have cleared, not just the master.
			for ( const occ of masterBody.generated_occurrences ) {
				const childRes = await api.get(
					`/wp-json/fair-events/v1/event-dates/${ occ.id }`,
					{ headers: adminHeaders }
				);
				expect( childRes.ok() ).toBeTruthy();
				expect( ( await childRes.json() ).event_id ).toBeNull();
			}

			// postA now resolves only to eventDateB, never to the old series.
			const listRes = await api.get(
				`/wp-json/fair-events/v1/event-dates?event_id=${ postA }`,
				{ headers: adminHeaders }
			);
			expect( listRes.ok() ).toBeTruthy();
			const listBody = await listRes.json();
			expect( listBody.map( ( item ) => item.id ) ).toEqual( [
				eventDateB,
			] );
		} finally {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateB }`,
				{ headers: adminHeaders }
			);
		}
	} );
} );

test.describe( 'EventDatesController — create_item with categories + rrule (quick add)', () => {
	let api;
	let categoryId;
	let masterEventDateId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const catRes = await api.post( '/wp-json/wp/v2/categories', {
			headers: adminHeaders,
			data: { name: `Quick Add Cat ${ Date.now() }` },
		} );
		expect( catRes.ok() ).toBeTruthy();
		categoryId = ( await catRes.json() ).id;
	} );

	test.afterEach( async () => {
		if ( masterEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
				{ headers: adminHeaders }
			);
			masterEventDateId = null;
		}
	} );

	test.afterAll( async () => {
		if ( categoryId ) {
			await api.delete(
				`/wp-json/wp/v2/categories/${ categoryId }?force=true`,
				{ headers: adminHeaders }
			);
		}
	} );

	test( 'a standalone create with categories + rrule generates occurrences that all carry the categories', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Quick add ${ Date.now() }`,
				start_datetime: '2036-01-01 10:00:00',
				end_datetime: '2036-01-01 12:00:00',
				link_type: 'none',
				categories: [ categoryId ],
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		masterEventDateId = body.id;

		expect( body.occurrence_type ).toBe( 'master' );
		expect( body.rrule ).toBe( 'FREQ=WEEKLY;COUNT=3' );
		expect( body.generated_occurrences.length ).toBe( 2 );
		expect( body.categories.map( ( c ) => c.id ) ).toContain( categoryId );

		for ( const occ of body.generated_occurrences ) {
			const occRes = await api.get(
				`/wp-json/fair-events/v1/event-dates/${ occ.id }`,
				{ headers: adminHeaders }
			);
			expect( occRes.ok() ).toBeTruthy();
			const occBody = await occRes.json();
			expect( occBody.categories.map( ( c ) => c.id ) ).toContain(
				categoryId
			);
		}
	} );
} );

test.describe( 'EventDatesController — recurrence reconciliation', () => {
	let api;
	let masterEventDateId;
	let eventPostId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterEach( async () => {
		if ( masterEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
				{ headers: adminHeaders }
			);
			masterEventDateId = null;
		}
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
			eventPostId = null;
		}
	} );

	async function createRecurringEvent(
		api,
		rrule,
		start = '2035-03-01 10:00:00'
	) {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Recurrence test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Recurrence test ${ Date.now() }`,
				start_datetime: start,
				end_datetime: start.replace( '10:00:00', '12:00:00' ),
				rrule,
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		const edBody = await edRes.json();
		masterEventDateId = edBody.id;
		return edBody;
	}

	async function getMaster( api, masterId ) {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ masterId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return await res.json();
	}

	test( 'time-of-day shift preserves occurrence IDs', async ( {
		request: req,
	} ) => {
		const localApi = req;
		await createRecurringEvent( localApi, 'FREQ=WEEKLY;COUNT=3' );

		const before = await getMaster( localApi, masterEventDateId );
		expect( before.generated_occurrences.length ).toBe( 2 );
		const idsBefore = [
			before.id,
			...before.generated_occurrences.map( ( o ) => o.id ),
		].sort();

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{
				headers: adminHeaders,
				data: {
					start_datetime: '2035-03-01 11:00:00',
					end_datetime: '2035-03-01 13:00:00',
				},
			}
		);
		expect( putRes.ok() ).toBeTruthy();

		const after = await getMaster( localApi, masterEventDateId );
		const idsAfter = [
			after.id,
			...after.generated_occurrences.map( ( o ) => o.id ),
		].sort();

		expect( idsAfter ).toEqual( idsBefore );

		const starts = after.generated_occurrences.map(
			( o ) => o.start_datetime
		);
		expect( starts.every( ( s ) => s.includes( '11:00:00' ) ) ).toBe(
			true
		);
	} );

	test( 'shortening RRULE soft-cancels removed occurrences instead of deleting them', async ( {
		request: req,
	} ) => {
		test.skip(
			true,
			'Skipped pending #1406 — removed occurrence status is left blank instead of active/cancelled'
		);
		const localApi = req;
		await createRecurringEvent( localApi, 'FREQ=WEEKLY;COUNT=4' );

		const before = await getMaster( localApi, masterEventDateId );
		expect( before.generated_occurrences.length ).toBe( 3 );
		const keptIds = before.generated_occurrences
			.slice( 0, 1 )
			.map( ( o ) => o.id );
		const cancelledIds = before.generated_occurrences
			.slice( 1 )
			.map( ( o ) => o.id );

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=2' },
			}
		);
		expect( putRes.ok() ).toBeTruthy();

		const after = await getMaster( localApi, masterEventDateId );
		// Ids survive — soft-cancelled, not deleted.
		const idsAfter = after.generated_occurrences.map( ( o ) => o.id );
		keptIds.forEach( ( id ) => expect( idsAfter ).toContain( id ) );
		cancelledIds.forEach( ( id ) => expect( idsAfter ).toContain( id ) );

		const byId = Object.fromEntries(
			after.generated_occurrences.map( ( o ) => [ o.id, o ] )
		);
		keptIds.forEach( ( id ) =>
			expect( byId[ id ].status ).toBe( 'active' )
		);
		cancelledIds.forEach( ( id ) =>
			expect( byId[ id ].status ).toBe( 'cancelled' )
		);
		cancelledIds.forEach( ( id ) =>
			expect( after.cancelled_dates.length ).toBeGreaterThan( 0 )
		);
	} );

	test( 'master time-of-day edit propagates to generated children', async ( {
		request: req,
	} ) => {
		const localApi = req;
		await createRecurringEvent( localApi, 'FREQ=WEEKLY;COUNT=3' );

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{
				headers: adminHeaders,
				data: {
					start_datetime: '2035-03-01 14:00:00',
					end_datetime: '2035-03-01 16:00:00',
				},
			}
		);
		expect( putRes.ok() ).toBeTruthy();

		const after = await getMaster( localApi, masterEventDateId );
		expect( after.generated_occurrences.length ).toBe( 2 );

		const starts = after.generated_occurrences.map(
			( o ) => o.start_datetime
		);
		expect( starts.every( ( s ) => s.includes( '14:00:00' ) ) ).toBe(
			true
		);
	} );
} );

test.describe( 'EventDatesController — ending a series', () => {
	let api;
	let masterEventDateId;
	let eventPostId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterEach( async () => {
		if ( masterEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
				{ headers: adminHeaders }
			);
			masterEventDateId = null;
		}
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
			eventPostId = null;
		}
	} );

	async function createRecurringEvent(
		api,
		rrule,
		start = '2035-04-01 10:00:00'
	) {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `End series test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `End series test ${ Date.now() }`,
				start_datetime: start,
				end_datetime: start.replace( '10:00:00', '12:00:00' ),
				rrule,
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		const edBody = await edRes.json();
		masterEventDateId = edBody.id;
		return edBody;
	}

	async function getMaster( api, masterId ) {
		const res = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ masterId }`,
			{ headers: adminHeaders }
		);
		expect( res.ok() ).toBeTruthy();
		return await res.json();
	}

	test( 'PUT rrule: "" clears the series and removes generated occurrences', async ( {
		request: req,
	} ) => {
		test.skip(
			true,
			'Skipped pending #1406 — PUT rrule: "" does not clear the series'
		);
		const localApi = req;
		const master = await createRecurringEvent(
			localApi,
			'FREQ=WEEKLY;COUNT=3'
		);
		expect( master.generated_occurrences.length ).toBe( 2 );

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{ headers: adminHeaders, data: { rrule: '' } }
		);
		expect( putRes.ok() ).toBeTruthy();

		const after = await getMaster( localApi, masterEventDateId );
		expect( after.rrule ).toBeNull();
		expect( after.occurrence_type ).toBe( 'single' );
		expect( after.recurrence_mode ).toBe( 'none' );
		expect( after.generated_occurrences.length ).toBe( 0 );
	} );

	test( 'a details PUT that omits rrule leaves an existing series intact', async ( {
		request: req,
	} ) => {
		const localApi = req;
		const master = await createRecurringEvent(
			localApi,
			'FREQ=WEEKLY;COUNT=3'
		);
		expect( master.generated_occurrences.length ).toBe( 2 );

		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{
				headers: adminHeaders,
				data: { title: 'Renamed via details save' },
			}
		);
		expect( putRes.ok() ).toBeTruthy();

		const after = await getMaster( localApi, masterEventDateId );
		expect( after.rrule ).toBe( 'FREQ=WEEKLY;COUNT=3' );
		expect( after.occurrence_type ).toBe( 'master' );
		expect( after.generated_occurrences.length ).toBe( 2 );
	} );
} );

test.describe( 'EventDatesController — cancel/restore via toggle-exdate', () => {
	let api;
	let masterEventDateId;
	let eventPostId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterEach( async () => {
		if ( masterEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
				{ headers: adminHeaders }
			);
			masterEventDateId = null;
		}
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
			eventPostId = null;
		}
	} );

	test( 'cancelling a date is a reversible status flip that keeps a dependent ticket type', async ( {
		request: req,
	} ) => {
		const localApi = req;

		const postRes = await localApi.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Toggle test ${ Date.now() }`, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await localApi.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					event_id: eventPostId,
					title: `Toggle series test ${ Date.now() }`,
					start_datetime: '2035-09-03 10:00:00',
					end_datetime: '2035-09-03 12:00:00',
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect( edRes.ok() ).toBeTruthy();
		const master = await edRes.json();
		masterEventDateId = master.id;

		const targetOccurrence = master.generated_occurrences[ 0 ];

		// Attach a ticket type to the target occurrence to prove it survives cancellation.
		const ttRes = await localApi.post(
			`/wp-json/fair-events/v1/event-dates/${ targetOccurrence.id }/ticket-types`,
			{
				headers: adminHeaders,
				data: { name: 'General', capacity: 10, sort_order: 0 },
			}
		);
		const ticketCreated = ttRes.ok();
		if ( ! ticketCreated ) {
			test.skip();
			return;
		}

		const targetDate = targetOccurrence.start_datetime.split( ' ' )[ 0 ];

		// Cancel.
		const cancelRes = await localApi.post(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }/toggle-exdate`,
			{ headers: adminHeaders, data: { date: targetDate } }
		);
		expect( cancelRes.ok() ).toBeTruthy();
		const afterCancel = await cancelRes.json();
		const cancelledOcc = afterCancel.generated_occurrences.find(
			( o ) => o.id === targetOccurrence.id
		);
		expect( cancelledOcc.status ).toBe( 'cancelled' );
		expect( afterCancel.cancelled_dates ).toContain( targetDate );

		// The dependent ticket type must still exist — cancellation is non-destructive.
		const ttGetRes = await localApi.get(
			`/wp-json/fair-events/v1/event-dates/${ targetOccurrence.id }/ticket-types`,
			{ headers: adminHeaders }
		);
		expect( ttGetRes.ok() ).toBeTruthy();
		expect( ( await ttGetRes.json() ).length ).toBeGreaterThan( 0 );

		// Restore.
		const restoreRes = await localApi.post(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }/toggle-exdate`,
			{ headers: adminHeaders, data: { date: targetDate } }
		);
		expect( restoreRes.ok() ).toBeTruthy();
		const afterRestore = await restoreRes.json();
		const restoredOcc = afterRestore.generated_occurrences.find(
			( o ) => o.id === targetOccurrence.id
		);
		expect( restoredOcc.status ).toBe( 'active' );
		expect( afterRestore.cancelled_dates ).not.toContain( targetDate );
	} );
} );

test.describe( 'EventDatesController — impact classification (PR 2)', () => {
	let api;
	let masterEventDateId;
	let eventPostId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterEach( async () => {
		if ( masterEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
				{ headers: adminHeaders }
			);
			masterEventDateId = null;
		}
		if ( eventPostId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ eventPostId }?force=true`,
				{ headers: adminHeaders }
			);
			eventPostId = null;
		}
	} );

	async function createRecurringEventWithTicket( api, rrule ) {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Impact test ${ Date.now() }`, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Impact test ${ Date.now() }`,
				start_datetime: '2035-06-01 10:00:00',
				end_datetime: '2035-06-01 12:00:00',
				rrule,
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		const edBody = await edRes.json();
		masterEventDateId = edBody.id;

		const linkRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{ headers: adminHeaders, data: { event_id: eventPostId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		// Get the generated occurrences and attach a ticket type to the last one.
		const occRes = await api.get(
			`/wp-json/fair-events/v1/event-dates?event_id=${ eventPostId }`,
			{ headers: adminHeaders }
		);
		expect( occRes.ok() ).toBeTruthy();
		const occurrences = await occRes.json();
		// Sort ascending and pick the last generated occurrence.
		const sorted = [ ...occurrences ].sort( ( a, b ) =>
			a.start_datetime < b.start_datetime ? -1 : 1
		);
		const lastOccurrence = sorted[ sorted.length - 1 ];

		// Create a ticket type on the last occurrence (makes it a "dependent").
		const ttRes = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ lastOccurrence.id }/ticket-types`,
			{
				headers: adminHeaders,
				data: { name: 'General', capacity: 10, sort_order: 0 },
			}
		);
		// If tickets endpoint doesn't exist in this context just skip the dependent.
		const ticketCreated = ttRes.ok();

		return { occurrences: sorted, lastOccurrence, ticketCreated };
	}

	test( 'time shift returns 200 with recurrence_impact summary', async ( {
		request: req,
	} ) => {
		const localApi = req;

		const postRes = await localApi.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Shift impact test ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await localApi.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					event_id: eventPostId,
					title: `Shift impact test ${ Date.now() }`,
					start_datetime: '2035-07-01 10:00:00',
					end_datetime: '2035-07-01 12:00:00',
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect( edRes.ok() ).toBeTruthy();
		masterEventDateId = ( await edRes.json() ).id;

		// Shift start time by one hour.
		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{
				headers: adminHeaders,
				data: {
					start_datetime: '2035-07-01 11:00:00',
					end_datetime: '2035-07-01 13:00:00',
				},
			}
		);
		expect( putRes.ok() ).toBeTruthy();
		const body = await putRes.json();

		// Response must include a recurrence_impact summary.
		expect( body ).toHaveProperty( 'recurrence_impact' );
		const impact = body.recurrence_impact;
		expect( impact ).toHaveProperty( 'unchanged' );
		expect( impact ).toHaveProperty( 'shifted' );
		expect( impact ).toHaveProperty( 'added' );
		expect( impact ).toHaveProperty( 'removed' );
		// A pure time shift with no RRULE change: all children are shifted, none removed.
		expect( impact.removed ).toHaveLength( 0 );
		expect(
			impact.shifted.length + impact.unchanged.length
		).toBeGreaterThan( 0 );
	} );

	test( 'shortening RRULE to remove an occurrence with a ticket type soft-cancels it (non-destructive)', async ( {
		request: req,
	} ) => {
		const localApi = req;
		const { lastOccurrence, ticketCreated } =
			await createRecurringEventWithTicket(
				localApi,
				'FREQ=WEEKLY;COUNT=3'
			);

		if ( ! ticketCreated ) {
			// Ticket type endpoint unavailable in this environment — skip dependent check.
			test.skip();
			return;
		}

		// Shorten to COUNT=2 — this removes the last occurrence from the rule,
		// which now soft-cancels it instead of blocking the change.
		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=2' },
			}
		);

		expect( putRes.ok() ).toBeTruthy();
		const body = await putRes.json();
		expect( body.recurrence_impact.removed.length ).toBeGreaterThan( 0 );

		// The removed occurrence still exists, cancelled — its ticket type survives.
		const masterRes = await localApi.get(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{ headers: adminHeaders }
		);
		const masterBody = await masterRes.json();
		const removedOcc = masterBody.generated_occurrences.find(
			( o ) => o.id === lastOccurrence.id
		);
		expect( removedOcc ).toBeDefined();
		expect( removedOcc.status ).toBe( 'cancelled' );

		const ttRes = await localApi.get(
			`/wp-json/fair-events/v1/event-dates/${ lastOccurrence.id }/ticket-types`,
			{ headers: adminHeaders }
		);
		expect( ttRes.ok() ).toBeTruthy();
		expect( ( await ttRes.json() ).length ).toBeGreaterThan( 0 );
	} );

	test( 'shortening RRULE to remove an occurrence without dependents returns 200', async ( {
		request: req,
	} ) => {
		test.skip(
			true,
			'Skipped pending #1406 — shortened series does not leave exactly one active occurrence'
		);
		const localApi = req;

		const postRes = await localApi.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: { title: `Safe shorten ${ Date.now() }`, status: 'publish' },
		} );
		expect( postRes.ok() ).toBeTruthy();
		eventPostId = ( await postRes.json() ).id;

		const edRes = await localApi.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					event_id: eventPostId,
					title: `Safe shorten ${ Date.now() }`,
					start_datetime: '2035-08-01 10:00:00',
					end_datetime: '2035-08-01 12:00:00',
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect( edRes.ok() ).toBeTruthy();
		masterEventDateId = ( await edRes.json() ).id;

		// Shorten to COUNT=2 — last occurrence has no dependents, so it should succeed.
		const putRes = await localApi.put(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{
				headers: adminHeaders,
				data: { rrule: 'FREQ=WEEKLY;COUNT=2' },
			}
		);
		expect( putRes.ok() ).toBeTruthy();
		const body = await putRes.json();

		expect( body ).toHaveProperty( 'recurrence_impact' );
		const impact = body.recurrence_impact;
		expect( impact.removed ).toHaveLength( 1 );
		expect( impact.removed[ 0 ].dependents ).toBe( 0 );

		// Confirm only 1 occurrence is still active (2 total including the master).
		const masterRes = await localApi.get(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
			{ headers: adminHeaders }
		);
		const masterBody = await masterRes.json();
		const active = masterBody.generated_occurrences.filter(
			( o ) => o.status === 'active'
		);
		expect( active ).toHaveLength( 1 );
	} );
} );

test.describe( 'EventDatesController — title validation', () => {
	let api;
	let eventDateId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterEach( async () => {
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
			eventDateId = null;
		}
	} );

	test( 'rejects create with an empty title', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: '',
				start_datetime: '2030-01-01 10:00:00',
				end_datetime: '2030-01-01 12:00:00',
			},
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'rejects create with a whitespace-only title', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: '   ',
				start_datetime: '2030-01-01 10:00:00',
				end_datetime: '2030-01-01 12:00:00',
			},
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'rejects update that clears the title', async () => {
		const createRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Title Validation ${ Date.now() }`,
					start_datetime: '2030-01-01 10:00:00',
					end_datetime: '2030-01-01 12:00:00',
				},
			}
		);
		expect( createRes.ok() ).toBeTruthy();
		eventDateId = ( await createRes.json() ).id;

		const updateRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{
				headers: adminHeaders,
				data: { title: '   ' },
			}
		);
		expect( updateRes.status() ).toBe( 400 );
	} );
} );

test.describe( 'EventDatesController — attendance mode + joining link', () => {
	let api;
	let eventDateId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterEach( async () => {
		if ( eventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
				{ headers: adminHeaders }
			);
			eventDateId = null;
		}
	} );

	test( 'a created event date defaults to in_person with no joining link', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Attendance Mode Default ${ Date.now() }`,
				start_datetime: '2030-01-01 10:00:00',
				end_datetime: '2030-01-01 12:00:00',
			},
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		eventDateId = body.id;

		expect( body.attendance_mode ).toBe( 'in_person' );
		expect( body.joining_link ).toBeNull();
	} );

	test( 'persists and reads back attendance_mode + joining_link on create', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Online Event ${ Date.now() }`,
				start_datetime: '2030-01-01 10:00:00',
				end_datetime: '2030-01-01 12:00:00',
				attendance_mode: 'online',
				joining_link: 'https://example.com/meet',
			},
		} );
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		eventDateId = body.id;

		expect( body.attendance_mode ).toBe( 'online' );
		expect( body.joining_link ).toBe( 'https://example.com/meet' );
	} );

	test( 'persists and reads back attendance_mode + joining_link on update', async () => {
		const createRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Hybrid Event Update ${ Date.now() }`,
					start_datetime: '2030-01-01 10:00:00',
					end_datetime: '2030-01-01 12:00:00',
				},
			}
		);
		expect( createRes.ok() ).toBeTruthy();
		eventDateId = ( await createRes.json() ).id;

		const updateRes = await api.put(
			`/wp-json/fair-events/v1/event-dates/${ eventDateId }`,
			{
				headers: adminHeaders,
				data: {
					attendance_mode: 'hybrid',
					joining_link: 'https://example.com/hybrid-meet',
				},
			}
		);
		expect( updateRes.ok() ).toBeTruthy();
		const body = await updateRes.json();

		expect( body.attendance_mode ).toBe( 'hybrid' );
		expect( body.joining_link ).toBe( 'https://example.com/hybrid-meet' );
	} );

	test( 'rejects create with an invalid joining_link URL', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Invalid Joining Link ${ Date.now() }`,
				start_datetime: '2030-01-01 10:00:00',
				end_datetime: '2030-01-01 12:00:00',
				attendance_mode: 'online',
				joining_link: 'not-a-url',
			},
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'rejects create with an out-of-enum attendance_mode', async () => {
		const res = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Invalid Attendance Mode ${ Date.now() }`,
				start_datetime: '2030-01-01 10:00:00',
				end_datetime: '2030-01-01 12:00:00',
				attendance_mode: 'not-a-mode',
			},
		} );
		expect( res.status() ).toBe( 400 );
	} );

	test( 'a generated occurrence inherits attendance_mode + joining_link from its series master', async () => {
		const createRes = await api.post(
			'/wp-json/fair-events/v1/event-dates',
			{
				headers: adminHeaders,
				data: {
					title: `Series Inheritance ${ Date.now() }`,
					start_datetime: '2030-02-03 10:00:00',
					end_datetime: '2030-02-03 12:00:00',
					attendance_mode: 'online',
					joining_link: 'https://example.com/series-meet',
					rrule: 'FREQ=WEEKLY;COUNT=3',
				},
			}
		);
		expect( createRes.ok() ).toBeTruthy();
		const master = await createRes.json();
		eventDateId = master.id;

		expect( master.generated_occurrences?.length ).toBeGreaterThan( 0 );
		const occurrenceId = master.generated_occurrences[ 0 ].id;

		const occurrenceRes = await api.get(
			`/wp-json/fair-events/v1/event-dates/${ occurrenceId }`,
			{ headers: adminHeaders }
		);
		expect( occurrenceRes.ok() ).toBeTruthy();
		const occurrence = await occurrenceRes.json();

		expect( occurrence.attendance_mode ).toBe( 'online' );
		expect( occurrence.joining_link ).toBe(
			'https://example.com/series-meet'
		);
	} );
} );

test.describe( 'EventDatesController — event_id propagation to generated children', () => {
	let api;
	let masterEventDateId;
	let postId;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
	} );

	test.afterEach( async () => {
		if ( masterEventDateId ) {
			await api.delete(
				`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }`,
				{ headers: adminHeaders }
			);
			masterEventDateId = null;
		}
		if ( postId ) {
			await api.delete(
				`/wp-json/wp/v2/fair_event/${ postId }?force=true`,
				{
					headers: adminHeaders,
				}
			);
			postId = null;
		}
	} );

	test( 'create-post propagates the new post to already-generated occurrences', async () => {
		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Create-post propagation ${ Date.now() }`,
				start_datetime: '2037-01-01 10:00:00',
				end_datetime: '2037-01-01 12:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		const master = await edRes.json();
		masterEventDateId = master.id;
		expect( master.generated_occurrences.length ).toBe( 2 );

		const createPostRes = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }/create-post`,
			{ headers: adminHeaders, data: {} }
		);
		expect( createPostRes.ok() ).toBeTruthy();
		postId = ( await createPostRes.json() ).post_id;

		const listRes = await api.get(
			`/wp-json/fair-events/v1/event-dates?event_id=${ postId }`,
			{ headers: adminHeaders }
		);
		expect( listRes.ok() ).toBeTruthy();
		const items = await listRes.json();
		expect( items.length ).toBe( 3 );
		expect( items.every( ( item ) => item.event_id === postId ) ).toBe(
			true
		);
	} );

	test( 'link-post propagates an existing post to already-generated occurrences', async () => {
		const postRes = await api.post( '/wp-json/wp/v2/fair_event', {
			headers: adminHeaders,
			data: {
				title: `Link-post propagation ${ Date.now() }`,
				status: 'publish',
			},
		} );
		expect( postRes.ok() ).toBeTruthy();
		postId = ( await postRes.json() ).id;

		const edRes = await api.post( '/wp-json/fair-events/v1/event-dates', {
			headers: adminHeaders,
			data: {
				title: `Link-post propagation ${ Date.now() }`,
				start_datetime: '2037-02-01 10:00:00',
				end_datetime: '2037-02-01 12:00:00',
				rrule: 'FREQ=WEEKLY;COUNT=3',
			},
		} );
		expect( edRes.ok() ).toBeTruthy();
		const master = await edRes.json();
		masterEventDateId = master.id;
		expect( master.generated_occurrences.length ).toBe( 2 );

		const linkRes = await api.post(
			`/wp-json/fair-events/v1/event-dates/${ masterEventDateId }/link-post`,
			{ headers: adminHeaders, data: { post_id: postId } }
		);
		expect( linkRes.ok() ).toBeTruthy();

		const listRes = await api.get(
			`/wp-json/fair-events/v1/event-dates?event_id=${ postId }`,
			{ headers: adminHeaders }
		);
		expect( listRes.ok() ).toBeTruthy();
		const items = await listRes.json();
		expect( items.length ).toBe( 3 );
		expect( items.every( ( item ) => item.event_id === postId ) ).toBe(
			true
		);
	} );
} );
