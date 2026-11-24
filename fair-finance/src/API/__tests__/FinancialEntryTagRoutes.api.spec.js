/**
 * Playwright API tests for the tag routes on FinancialEntryController.
 *
 * Exercises GET /fair-finance/v1/financial-entries/tags,
 * GET /fair-finance/v1/financial-entries/totals-by-tag, and
 * GET /fair-finance/v1/financial-entries?tag=... against a live WordPress
 * instance using admin Application Password credentials.
 */

import { test, expect, request } from '@playwright/test';
import {
	ADMIN_HEADERS,
	ENTRIES_API,
	splitFixtures,
} from './helpers/split-fixtures.js';

const BASE_URL = process.env.WP_BASE_URL || 'http://localhost:8080';
const ADMIN_USER = process.env.WP_ADMIN_USER || 'admin';
const ADMIN_PASSWORD = process.env.WP_ADMIN_PASSWORD || 'password';

const adminAuth = Buffer.from( `${ ADMIN_USER }:${ ADMIN_PASSWORD }` ).toString(
	'base64'
);

test.describe( 'FinancialEntry tag routes', () => {
	let api;
	let entryId;
	const testTag = `test-tag-${ Date.now() }`;

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );

		const res = await api.post(
			'/wp-json/fair-finance/v1/financial-entries',
			{
				headers: { Authorization: `Basic ${ adminAuth }` },
				data: {
					amount: 42.0,
					entry_type: 'cost',
					entry_date: '2026-01-15',
					description: 'Tag route test entry',
					tag: testTag,
				},
			}
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		entryId = body.id;
		expect( entryId ).toBeTruthy();
	} );

	test.afterAll( async () => {
		if ( entryId ) {
			await api.delete(
				`/wp-json/fair-finance/v1/financial-entries/${ entryId }`,
				{
					headers: { Authorization: `Basic ${ adminAuth }` },
				}
			);
		}
		await api.dispose();
	} );

	test( 'GET /tags returns the test tag', async () => {
		const res = await api.get(
			'/wp-json/fair-finance/v1/financial-entries/tags',
			{
				headers: { Authorization: `Basic ${ adminAuth }` },
			}
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		expect( Array.isArray( body ) ).toBe( true );
		expect( body ).toContain( testTag );
	} );

	test( 'GET /totals-by-tag returns cost total for the test tag', async () => {
		const res = await api.get(
			'/wp-json/fair-finance/v1/financial-entries/totals-by-tag',
			{
				headers: { Authorization: `Basic ${ adminAuth }` },
			}
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		expect( body[ testTag ] ).toBeDefined();
		expect( body[ testTag ].total_cost ).toBeGreaterThanOrEqual( 42.0 );
		expect( body[ testTag ].total_income ).toBeDefined();
		expect( body[ testTag ].balance ).toBeDefined();
	} );

	test( 'GET /financial-entries?tag= filters by tag', async () => {
		const res = await api.get(
			`/wp-json/fair-finance/v1/financial-entries?tag=${ encodeURIComponent(
				testTag
			) }`,
			{
				headers: { Authorization: `Basic ${ adminAuth }` },
			}
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		expect( Array.isArray( body.entries ) ).toBe( true );
		expect( body.entries.length ).toBeGreaterThan( 0 );
		body.entries.forEach( ( entry ) => {
			expect( entry.tag ).toBe( testTag );
		} );
	} );

	test( 'GET /financial-entries?tag=none returns only untagged entries', async () => {
		const res = await api.get(
			'/wp-json/fair-finance/v1/financial-entries?tag=none',
			{
				headers: { Authorization: `Basic ${ adminAuth }` },
			}
		);
		expect( res.ok() ).toBeTruthy();
		const body = await res.json();
		expect( Array.isArray( body.entries ) ).toBe( true );
		body.entries.forEach( ( entry ) => {
			expect( entry.tag ).toBeNull();
		} );
	} );

	test( 'requires authentication', async () => {
		const res = await api.get(
			'/wp-json/fair-finance/v1/financial-entries/tags'
		);
		expect( res.status() ).toBe( 401 );
	} );
} );

test.describe( 'Split allocation tags (#2341)', () => {
	const STAMP = Date.now().toString( 36 );
	// A date no other spec uses keeps the untagged listing to our entries.
	const DATE = '2033-05-05';
	const PARENT_TAG = `split-parent-${ STAMP }`;
	const TAG_A = `split-a-${ STAMP }`;
	const TAG_B = `split-b-${ STAMP }`;
	const TAG_FILTER = `split-filter-${ STAMP }`;
	const headers = ADMIN_HEADERS;
	const API = ENTRIES_API;
	const fixtures = splitFixtures( {
		entry_date: DATE,
		description: `Split tag entry ${ STAMP }`,
		tag: PARENT_TAG,
	} );
	const { createEntry, split, focused } = fixtures;

	const childTags = async ( id ) => {
		const entry = await focused( id );
		return {
			parentTag: entry.tag,
			tags: ( entry.children || [] ).map( ( child ) => child.tag ),
		};
	};

	const list = async ( query ) => {
		const res = await fixtures.api.get(
			`${ API }?date_from=${ DATE }&date_to=${ DATE }&per_page=100&${ query }`,
			{ headers }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	};

	const totals = async ( query ) => {
		const res = await fixtures.api.get(
			`${ API }/totals?date_from=${ DATE }&date_to=${ DATE }&${ query }`,
			{ headers }
		);
		expect( res.ok() ).toBeTruthy();
		return res.json();
	};

	test.beforeAll( () => fixtures.open() );
	test.afterAll( () => fixtures.close() );

	test( 'creates allocations with explicit, cleared and inherited tags', async () => {
		const id = await createEntry();

		const res = await split( id, [
			{ amount: 40, tag: TAG_A },
			{ amount: 30, tag: null },
			{ amount: 20, tag: '' },
			// Omitting the tag keeps the original entry's tag.
			{ amount: 10 },
		] );
		expect( res.status(), await res.text() ).toBe( 201 );

		expect( await childTags( id ) ).toEqual( {
			parentTag: null,
			tags: [ TAG_A, null, null, PARENT_TAG ],
		} );
	} );

	test( 'updates, clears and keeps allocation tags on edit', async () => {
		const id = await createEntry();
		expect(
			(
				await split( id, [
					{ amount: 60, tag: TAG_A, description: 'Room' },
					{ amount: 40, tag: TAG_B, description: 'Snacks' },
				] )
			).status()
		).toBe( 201 );

		// Changing only amounts and descriptions keeps the sent tags.
		let res = await split(
			id,
			[
				{ amount: 70, tag: TAG_A, description: 'Room and stage' },
				{ amount: 30, tag: TAG_B, description: 'Coffee' },
			],
			'put'
		);
		expect( res.status(), await res.text() ).toBe( 200 );
		expect( ( await childTags( id ) ).tags ).toEqual( [ TAG_A, TAG_B ] );

		res = await split(
			id,
			[
				{ amount: 70, tag: TAG_B },
				{ amount: 30, tag: null },
			],
			'put'
		);
		expect( res.status(), await res.text() ).toBe( 200 );
		expect( await childTags( id ) ).toEqual( {
			parentTag: null,
			tags: [ TAG_B, null ],
		} );
	} );

	test( 'rejects a malformed allocation tag without changing the entry', async () => {
		const id = await createEntry();

		for ( const tag of [ 42, [ 'venue' ], 'x'.repeat( 101 ) ] ) {
			const res = await split( id, [
				{ amount: 50, tag },
				{ amount: 50, tag: TAG_A },
			] );
			expect( res.status() ).toBe( 400 );
		}

		expect( await childTags( id ) ).toEqual( {
			parentTag: PARENT_TAG,
			tags: [],
		} );
	} );

	test( 'filters and totals count allocations, not their split parent', async () => {
		const id = await createEntry( { amount: 90 } );
		const standalone = await createEntry( { amount: 5, tag: null } );
		expect(
			(
				await split( id, [
					{ amount: 50, tag: TAG_FILTER },
					{ amount: 40, tag: null },
				] )
			).status()
		).toBe( 201 );

		const named = await list( `tag=${ encodeURIComponent( TAG_FILTER ) }` );
		expect( named.entries.map( ( e ) => e.amount ) ).toEqual( [ 50 ] );
		expect( named.entries[ 0 ].parent_entry_id ).toBe( id );
		expect( named.total ).toBe( 1 );
		expect(
			( await totals( `tag=${ encodeURIComponent( TAG_FILTER ) }` ) )
				.total_cost
		).toBe( 50 );

		// Untagged: the cleared allocation and the standalone entry, never
		// the split parent (whose own tag is always cleared).
		const untagged = await list( 'tag=none' );
		const ours = untagged.entries.filter(
			( e ) =>
				e.id === standalone || e.parent_entry_id === id || e.id === id
		);
		expect( ours.map( ( e ) => [ e.id === id, e.amount ] ).sort() ).toEqual(
			[
				[ false, 40 ],
				[ false, 5 ],
			]
		);
		untagged.entries.forEach( ( e ) => {
			expect( e.tag ).toBeNull();
			expect( e.children || [] ).toHaveLength( 0 );
		} );
		expect( untagged.total ).toBe( untagged.entries.length );

		const byTag = await (
			await fixtures.api.get( `${ API }/totals-by-tag`, { headers } )
		).json();
		expect( byTag[ TAG_FILTER ] ).toMatchObject( {
			total_cost: 50,
			cost_count: 1,
		} );
	} );
} );

test.describe( 'No tag filter on a mixed split (#2385)', () => {
	let api;
	let parentId;
	const STAMP = Date.now().toString( 36 );
	// A date no other spec uses keeps these listings to our entry.
	const DATE = '2033-06-07';
	const VENUE = `venue-${ STAMP }`;
	const headers = { Authorization: `Basic ${ adminAuth }` };
	const API = '/wp-json/fair-finance/v1/financial-entries';
	const RANGE = `date_from=${ DATE }&date_to=${ DATE }`;

	const get = async ( path ) => {
		const res = await api.get( path, { headers } );
		expect( res.ok(), await res.text() ).toBeTruthy();
		return res.json();
	};

	test.beforeAll( async () => {
		api = await request.newContext( { baseURL: BASE_URL } );
		const res = await api.post( API, {
			headers,
			data: {
				amount: 100,
				entry_type: 'cost',
				entry_date: DATE,
				description: `Mixed split ${ STAMP }`,
			},
		} );
		expect( res.ok(), await res.text() ).toBeTruthy();
		parentId = ( await res.json() ).id;

		const splitRes = await api.post( `${ API }/${ parentId }/split`, {
			headers,
			data: {
				allocations: [
					{ amount: 60, tag: VENUE },
					{ amount: 40, tag: null },
				],
			},
		} );
		expect( splitRes.status(), await splitRes.text() ).toBe( 201 );
	} );

	test.afterAll( async () => {
		if ( parentId ) {
			await api.delete( `${ API }/${ parentId }/split`, { headers } );
			await api.delete( `${ API }/${ parentId }`, { headers } );
		}
		await api.dispose();
	} );

	test( 'tag=none lists and totals only the untagged allocation', async () => {
		const untagged = await get( `${ API }?${ RANGE }&tag=none&per_page=1` );
		expect( untagged.total ).toBe( 1 );
		expect( untagged.pages ).toBe( 1 );
		expect( untagged.entries ).toHaveLength( 1 );
		expect( untagged.entries[ 0 ] ).toMatchObject( {
			amount: 40,
			tag: null,
			parent_entry_id: parentId,
		} );
		// Parent metadata stays available for the split-edit action.
		expect( untagged.entries[ 0 ].parent.id ).toBe( parentId );

		const totals = await get( `${ API }/totals?${ RANGE }&tag=none` );
		expect( totals.total_cost ).toBe( 40 );
		expect( totals.total_income ).toBe( 0 );
	} );

	test( 'the named tag lists its allocation and no tag restores the parent row', async () => {
		const named = await get(
			`${ API }?${ RANGE }&tag=${ encodeURIComponent( VENUE ) }`
		);
		expect( named.total ).toBe( 1 );
		expect( named.entries[ 0 ] ).toMatchObject( {
			amount: 60,
			tag: VENUE,
			parent_entry_id: parentId,
		} );
		expect(
			(
				await get(
					`${ API }/totals?${ RANGE }&tag=${ encodeURIComponent(
						VENUE
					) }`
				)
			).total_cost
		).toBe( 60 );

		const all = await get( `${ API }?${ RANGE }` );
		expect( all.total ).toBe( 1 );
		expect( all.entries[ 0 ] ).toMatchObject( {
			id: parentId,
			amount: 100,
		} );
		expect(
			all.entries[ 0 ].children.map( ( child ) => child.amount ).sort()
		).toEqual( [ 40, 60 ] );
		expect( ( await get( `${ API }/totals?${ RANGE }` ) ).total_cost ).toBe(
			100
		);
	} );
} );
