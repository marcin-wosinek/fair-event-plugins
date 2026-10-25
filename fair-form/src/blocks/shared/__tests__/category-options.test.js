jest.mock( '@wordpress/api-fetch', () => jest.fn() );
// eslint-disable-next-line import/first
import apiFetch from '@wordpress/api-fetch';
// eslint-disable-next-line import/first
import {
	fetchAllCategories,
	resolveCategoryChoices,
	categoryPath,
	isCategorySource,
} from '../category-options.js';

const CATEGORIES = [
	{ id: 1, name: 'Uncategorized', parent: 0 },
	{ id: 10, name: 'Workshops', parent: 0 },
	{ id: 11, name: 'Juggling', parent: 10 },
	{ id: 12, name: 'Aerial', parent: 10 },
	// A grandchild listed before its parent, as pagination may deliver it.
	{ id: 14, name: 'Silks &amp; Hoops', parent: 13 },
	{ id: 13, name: 'Advanced', parent: 12 },
	{ id: 20, name: 'Empty parent', parent: 0 },
];

const page = ( items, totalPages ) => ( {
	headers: { get: () => String( totalPages ) },
	json: async () => items,
} );

describe( 'resolveCategoryChoices', () => {
	it( 'lists every category alphabetically for the all-categories source', () => {
		expect(
			resolveCategoryChoices( CATEGORIES, { optionSource: 'categories' } )
		).toEqual( {
			status: 'ready',
			choices: [
				'Advanced',
				'Aerial',
				'Empty parent',
				'Juggling',
				'Silks & Hoops',
				'Uncategorized',
				'Workshops',
			],
		} );
	} );

	it( 'lists every descendant of the parent, excluding the parent itself', () => {
		expect(
			resolveCategoryChoices( CATEGORIES, {
				optionSource: 'categoryChildren',
				parentCategoryId: 10,
			} ).choices
		).toEqual( [ 'Advanced', 'Aerial', 'Juggling', 'Silks & Hoops' ] );
	} );

	it( 'reports a parent that is not chosen yet', () => {
		expect(
			resolveCategoryChoices( CATEGORIES, {
				optionSource: 'categoryChildren',
				parentCategoryId: 0,
			} )
		).toEqual( { status: 'no-parent', choices: [] } );
	} );

	it( 'reports a missing parent without falling back to every category', () => {
		expect(
			resolveCategoryChoices( CATEGORIES, {
				optionSource: 'categoryChildren',
				parentCategoryId: 999,
			} )
		).toEqual( { status: 'missing-parent', choices: [] } );
	} );

	it( 'reports a parent without subcategories as empty', () => {
		expect(
			resolveCategoryChoices( CATEGORIES, {
				optionSource: 'categoryChildren',
				parentCategoryId: 20,
			} )
		).toEqual( { status: 'empty', choices: [] } );
	} );

	it( 'reports a site without categories as empty', () => {
		expect(
			resolveCategoryChoices( [], { optionSource: 'categories' } )
		).toEqual( { status: 'empty', choices: [] } );
	} );

	it( 'lists identically named categories once', () => {
		expect(
			resolveCategoryChoices(
				[
					{ id: 1, name: 'Kids', parent: 0 },
					{ id: 2, name: 'Kids', parent: 1 },
				],
				{ optionSource: 'categories' }
			).choices
		).toEqual( [ 'Kids' ] );
	} );
} );

describe( 'isCategorySource', () => {
	it( 'treats content saved before the attribute existed as typed options', () => {
		expect( isCategorySource( {} ) ).toBe( false );
		expect( isCategorySource( { optionSource: 'manual' } ) ).toBe( false );
		expect( isCategorySource( { optionSource: 'categories' } ) ).toBe(
			true
		);
		expect( isCategorySource( { optionSource: 'categoryChildren' } ) ).toBe(
			true
		);
	} );
} );

describe( 'categoryPath', () => {
	it( 'labels a category with its ancestors', () => {
		expect( categoryPath( CATEGORIES[ 4 ], CATEGORIES ) ).toBe(
			'Workshops › Aerial › Advanced › Silks & Hoops'
		);
	} );
} );

describe( 'fetchAllCategories', () => {
	beforeEach( () => apiFetch.mockReset() );

	it( 'follows the pagination beyond 100 categories', async () => {
		const first = Array.from( { length: 100 }, ( _, i ) => ( {
			id: i + 1,
			name: `Category ${ i + 1 }`,
			parent: 0,
		} ) );
		apiFetch
			.mockResolvedValueOnce( page( first, 2 ) )
			.mockResolvedValueOnce(
				page( [ { id: 101, name: 'Last', parent: 0 } ], 2 )
			);

		const categories = await fetchAllCategories();

		expect( categories ).toHaveLength( 101 );
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toMatch(
			/^\/wp\/v2\/categories\?per_page=100&page=1&/
		);
		expect( apiFetch.mock.calls[ 1 ][ 0 ].path ).toContain( '&page=2&' );
	} );

	it( 'rejects when a page fails to load', async () => {
		apiFetch.mockRejectedValueOnce( new Error( 'offline' ) );
		await expect( fetchAllCategories() ).rejects.toThrow( 'offline' );
	} );
} );
