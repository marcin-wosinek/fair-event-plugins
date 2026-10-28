/**
 * Weekly-update state of the Mailing Signup form (#2042): the request it
 * submits, its validation, and the message for each signup response.
 */

import {
	createWeeklyState,
	setWeeklyChecked,
	setFeedSelected,
	weeklyError,
	weeklyRequestData,
	responseNotice,
} from '../signupModel.js';

const multiselect = ( checked = false ) =>
	createWeeklyState( {
		config: 'signed',
		feedMode: 'multiselect',
		offered: true,
		checked,
	} );

describe( 'weekly state', () => {
	it( 'is absent when the form offers no weekly update', () => {
		expect(
			createWeeklyState( { config: undefined, offered: false } )
		).toBe( null );
		expect( weeklyRequestData( null ) ).toEqual( {} );
		expect( weeklyError( null ) ).toBe( null );
	} );

	it( 'starts with the rendered default and no feeds selected', () => {
		expect( multiselect( true ) ).toMatchObject( {
			checked: true,
			feedIds: [],
		} );
	} );

	it( 'declines the weekly update when its feeds cannot be offered', () => {
		const weekly = createWeeklyState( {
			config: 'signed',
			feedMode: 'hidden',
			offered: false,
			checked: true,
		} );

		expect( setWeeklyChecked( weekly, true ).checked ).toBe( false );
		expect( weeklyRequestData( weekly ) ).toEqual( {
			weekly_config: 'signed',
			weekly_summary: false,
		} );
	} );
} );

describe( 'weeklyError', () => {
	it( 'requires a feed when the weekly update is checked', () => {
		expect( weeklyError( multiselect( true ) ) ).toMatch(
			/at least one event feed/
		);
		expect(
			weeklyError( setFeedSelected( multiselect( true ), 3, true ) )
		).toBe( null );
	} );

	it( 'allows no feeds when the weekly update is unchecked', () => {
		expect( weeklyError( multiselect( false ) ) ).toBe( null );
	} );

	it( 'never asks for a feed on a hidden-feed form', () => {
		const weekly = createWeeklyState( {
			config: 'signed',
			feedMode: 'hidden',
			offered: true,
			checked: true,
		} );

		expect( weeklyError( weekly ) ).toBe( null );
	} );
} );

describe( 'weeklyRequestData', () => {
	it( 'sends every selected feed, once each', () => {
		let weekly = multiselect( true );
		weekly = setFeedSelected( weekly, 7, true );
		weekly = setFeedSelected( weekly, 3, true );
		weekly = setFeedSelected( weekly, 7, true );
		weekly = setFeedSelected( weekly, 5, true );
		weekly = setFeedSelected( weekly, 5, false );

		expect( weeklyRequestData( weekly ) ).toEqual( {
			weekly_config: 'signed',
			weekly_summary: true,
			weekly_feed_ids: [ 3, 7 ],
		} );
	} );

	it( 'sends selected feeds also when the weekly update is unchecked', () => {
		const weekly = setFeedSelected( multiselect( false ), 3, true );

		expect( weeklyRequestData( weekly ) ).toEqual( {
			weekly_config: 'signed',
			weekly_summary: false,
			weekly_feed_ids: [ 3 ],
		} );
	} );

	it( 'leaves the feed of a hidden-feed form to the server', () => {
		const weekly = createWeeklyState( {
			config: 'signed',
			feedMode: 'hidden',
			offered: true,
			checked: true,
		} );

		expect( weeklyRequestData( weekly ) ).toEqual( {
			weekly_config: 'signed',
			weekly_summary: true,
		} );
	} );
} );

describe( 'responseNotice', () => {
	it( 'shows the block message and clears the form for a new signup', () => {
		expect(
			responseNotice( { status: 'pending', message: 'x' }, 'Check mail' )
		).toEqual( { message: 'Check mail', type: 'success', reset: true } );
	} );

	it.each( [ 'already_subscribed', 'resent', 'manage_link_sent' ] )(
		'shows the server message for %s and keeps the input',
		( status ) => {
			expect(
				responseNotice( { status, message: 'Server says' }, 'Check' )
			).toEqual( { message: 'Server says', type: 'info', reset: false } );
		}
	);

	it.each( [ 'preferences_updated', 'confirmed' ] )(
		'confirms %s with the server message',
		( status ) => {
			expect(
				responseNotice( { status, message: 'Updated' }, 'Check' )
			).toEqual( {
				message: 'Updated',
				type: 'success',
				reset: false,
			} );
		}
	);
} );
