import { normalizeTimeFilters, togglePeriod } from '../timeFilters.js';

describe( 'normalizeTimeFilters', () => {
	it.each( [
		[ 'all', [ 'past', 'current', 'future' ] ],
		[ 'upcoming', [ 'future' ] ],
		[ 'ongoing', [ 'current' ] ],
		[ 'past', [ 'past' ] ],
		[ undefined, [ 'future' ] ],
		[ 'unknown', [ 'future' ] ],
	] )( 'maps legacy "%s"', ( timeFilter, expected ) => {
		expect( normalizeTimeFilters( { timeFilter } ) ).toEqual( expected );
	} );

	it( 'keeps an explicit empty selection', () => {
		expect(
			normalizeTimeFilters( { timeFilter: 'all', timeFilters: [] } )
		).toEqual( [] );
	} );

	it( 'orders saved periods and drops unknown ones', () => {
		expect(
			normalizeTimeFilters( {
				timeFilters: [ 'future', 'bogus', 'past' ],
			} )
		).toEqual( [ 'past', 'future' ] );
	} );
} );

describe( 'togglePeriod', () => {
	it( 'adds a period in display order', () => {
		expect( togglePeriod( [ 'future' ], 'past', true ) ).toEqual( [
			'past',
			'future',
		] );
	} );

	it( 'removes a period', () => {
		expect(
			togglePeriod( [ 'current', 'future' ], 'future', false )
		).toEqual( [ 'current' ] );
	} );
} );
