/**
 * @jest-environment jsdom
 */
import { locationUrl, parseLocation } from '../navigation.js';
import { feedOf } from '../NotificationList.js';

const ADMIN = '/wp-admin/admin.php?page=fair-events-event-notifications';

beforeEach( () => {
	window.history.replaceState( null, '', ADMIN );
} );

function query( url ) {
	return Object.fromEntries( new URLSearchParams( url.split( '?' )[ 1 ] ) );
}

describe( 'feed parameter', () => {
	it( 'means every feed when it is missing', () => {
		expect( parseLocation( '?page=x' ).feed ).toBe( '' );
		expect( parseLocation( '?page=x&feed=' ).feed ).toBe( '' );
	} );

	it( 'reads the feed slug of the list', () => {
		expect( parseLocation( '?feed=city&s=tg&list_page=3' ) ).toMatchObject(
			{ view: 'list', feed: 'city', search: 'tg', listPage: 3 }
		);
	} );

	it( 'keeps the feed with the search and page of the list', () => {
		expect(
			query(
				locationUrl( {
					view: 'list',
					feed: 'city',
					search: 'tg',
					listPage: 2,
				} )
			)
		).toEqual( {
			page: 'fair-events-event-notifications',
			feed: 'city',
			s: 'tg',
			list_page: '2',
		} );
	} );

	it( 'leaves out an empty feed', () => {
		expect(
			query( locationUrl( { view: 'list', feed: '', search: 'tg' } ) )
		).toEqual( { page: 'fair-events-event-notifications', s: 'tg' } );
	} );

	it( 'belongs to the list only', () => {
		const state = parseLocation( '?feed=city' );
		expect(
			query(
				locationUrl( {
					...state,
					view: 'configuration',
					configuration: 'telegram',
				} )
			)
		).not.toHaveProperty( 'feed' );
		expect(
			query( locationUrl( { ...state, view: 'history' } ) )
		).not.toHaveProperty( 'feed' );
	} );

	it( 'round-trips through the URL', () => {
		const state = parseLocation( '?feed=members&list_page=4' );
		expect(
			parseLocation( locationUrl( state ).split( '?' )[ 1 ] )
		).toEqual( state );
	} );
} );

describe( 'feedOf', () => {
	it( 'reads the feed of Telegram and bulk email', () => {
		expect( feedOf( { type: 'telegram', source_slug: 'city' } ) ).toBe(
			'city'
		);
		expect( feedOf( { type: 'bulk_email', source_slug: '' } ) ).toBe( '' );
	} );

	it( 'reads the event selection of individual email, except all local events', () => {
		expect(
			feedOf( { type: 'individual_email', event_selection: 'city' } )
		).toBe( 'city' );
		expect(
			feedOf( { type: 'individual_email', event_selection: '@local' } )
		).toBe( '' );
	} );
} );
