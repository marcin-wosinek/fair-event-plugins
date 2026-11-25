/**
 * Tests for the public marketing assets page model (#2430).
 */
import {
	initialState,
	reducer,
	isFiltered,
	hasMore,
	listPath,
	memberName,
	imageSaving,
	hasMeaningfulText,
} from '../model.js';

const list = ( overrides = {} ) => ( {
	items: [ { id: 1 } ],
	total: 3,
	page: 1,
	filters: { members: [ { key: 'a'.repeat( 16 ) } ], labels: [ 'Post' ] },
	...overrides,
} );

describe( 'public marketing assets model', () => {
	it( 'loads, appends more and reports more entries', () => {
		let state = initialState( { view: 'occurrence', eventDateId: 7 } );
		expect( state.phase ).toBe( 'loading' );
		state = reducer( state, { type: 'load-success', list: list() } );
		expect( state ).toMatchObject( { phase: 'ready', total: 3, page: 1 } );
		expect( state.offered.labels ).toEqual( [ 'Post' ] );
		expect( hasMore( state ) ).toBe( true );

		state = reducer( state, { type: 'more-start' } );
		expect( state.loadingMore ).toBe( true );
		state = reducer( state, {
			type: 'more-success',
			list: list( { items: [ { id: 2 }, { id: 3 } ], page: 2 } ),
		} );
		expect( state.items.map( ( item ) => item.id ) ).toEqual( [ 1, 2, 3 ] );
		expect( hasMore( state ) ).toBe( false );
	} );

	it( 'keeps loaded entries when loading more fails', () => {
		let state = reducer( initialState( { view: 'index' } ), {
			type: 'load-success',
			list: list(),
		} );
		state = reducer( state, { type: 'more-start' } );
		state = reducer( state, { type: 'more-error', message: 'Offline' } );
		expect( state ).toMatchObject( {
			loadingMore: false,
			moreError: 'Offline',
			phase: 'ready',
		} );
		expect( state.items ).toHaveLength( 1 );
	} );

	it( 'asks for page 1 again when a filter changes, is cleared or a retry runs', () => {
		let state = initialState( { view: 'occurrence', eventDateId: 7 } );
		state = reducer( state, { type: 'load-error', message: 'Down' } );
		expect( state ).toMatchObject( { phase: 'error', error: 'Down' } );
		state = reducer( state, { type: 'retry' } );
		expect( state.requestKey ).toBe( 1 );

		state = reducer( state, {
			type: 'select',
			name: 'label',
			value: 'WhatsApp status',
		} );
		expect( isFiltered( state ) ).toBe( true );
		expect( state.requestKey ).toBe( 2 );
		state = reducer( state, { type: 'clear-filters' } );
		expect( isFiltered( state ) ).toBe( false );
		expect( state.requestKey ).toBe( 3 );
	} );

	it( 'builds hardcoded REST paths with the filters', () => {
		const index = initialState( { view: 'index' } );
		expect( listPath( index, 2 ) ).toBe(
			'/fair-events/v1/marketing-assets?per_page=50&page=2'
		);

		let state = initialState( { view: 'occurrence', eventDateId: 7 } );
		expect( listPath( state, 1 ) ).toBe(
			'/fair-events/v1/marketing-assets/7?per_page=50&page=1'
		);
		state = reducer( state, {
			type: 'select',
			name: 'label',
			value: 'Post & story',
		} );
		state = reducer( state, {
			type: 'select',
			name: 'member',
			value: '0123456789abcdef',
		} );
		expect( listPath( state, 1 ) ).toBe(
			'/fair-events/v1/marketing-assets/7?per_page=50&page=1&label=Post+%26+story&member=0123456789abcdef'
		);
	} );

	it( 'records copy results per asset and resets them on reload', () => {
		let state = reducer( initialState( { view: 'occurrence' } ), {
			type: 'copy-result',
			id: 4,
			result: 'copied',
		} );
		expect( state.copied ).toEqual( { 4: 'copied' } );
		state = reducer( state, { type: 'load-success', list: list() } );
		expect( state.copied ).toEqual( {} );
	} );

	it( 'names members and checks for text to copy', () => {
		expect( memberName( { name: 'Ana', surname: '' } ) ).toBe( 'Ana' );
		expect( memberName( { name: 'Ana', surname: 'Ruiz' } ) ).toBe(
			'Ana Ruiz'
		);
		expect( hasMeaningfulText( ' \n\t​ ' ) ).toBe( false );
		expect( hasMeaningfulText( '\n🎉' ) ).toBe( true );
	} );

	it( 'downloads same-origin images and opens others', () => {
		expect(
			imageSaving(
				'https://example.org/wp-content/uploads/2026/11/caf%C3%A9.png',
				'https://example.org'
			)
		).toEqual( { download: true, filename: 'café.png' } );
		expect(
			imageSaving(
				'https://cdn.example.net/uploads/poster.jpg',
				'https://example.org'
			)
		).toEqual( { download: false, filename: 'poster.jpg' } );
	} );
} );
