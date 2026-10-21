/**
 * Tests for the shared calendar's month arithmetic and visible range.
 */
import {
	startOfMonth,
	addMonths,
	formatMonthParam,
	parseMonthParam,
	getCalendarDays,
	getVisibleRange,
} from '../month.js';

describe( 'month helpers', () => {
	it( 'moves across year boundaries', () => {
		expect( addMonths( new Date( 2026, 11, 15 ), 1 ) ).toEqual(
			new Date( 2027, 0, 1 )
		);
		expect( addMonths( new Date( 2026, 0, 31 ), -1 ) ).toEqual(
			new Date( 2025, 11, 1 )
		);
		expect( startOfMonth( new Date( 2026, 6, 31, 15 ) ) ).toEqual(
			new Date( 2026, 6, 1 )
		);
	} );

	it( 'round-trips the month URL value', () => {
		expect( formatMonthParam( new Date( 2026, 0, 9 ) ) ).toBe( '2026-01' );
		expect( parseMonthParam( '2026-01' ) ).toEqual(
			new Date( 2026, 0, 1 )
		);
	} );

	it.each( [ null, '', '2026-13', '2026-00', '2026-1', 'July', '2026-07x' ] )(
		'rejects malformed month %p',
		( value ) => {
			expect( parseMonthParam( value ) ).toBeNull();
		}
	);
} );

describe( 'getCalendarDays', () => {
	it( 'pads July 2026 to whole Monday-first weeks', () => {
		// July 2026 starts on a Wednesday and ends on a Friday.
		const days = getCalendarDays( new Date( 2026, 6, 1 ), 1 );
		expect( days ).toHaveLength( 35 );
		expect( days[ 0 ].date ).toEqual( new Date( 2026, 5, 29 ) );
		expect( days[ 0 ].isCurrentMonth ).toBe( false );
		expect( days[ 2 ].date ).toEqual( new Date( 2026, 6, 1 ) );
		expect( days[ 2 ].isCurrentMonth ).toBe( true );
		expect( days[ 34 ].date ).toEqual( new Date( 2026, 7, 2 ) );
		expect( days[ 34 ].isCurrentMonth ).toBe( false );
	} );

	it( 'honours a Sunday week start', () => {
		const days = getCalendarDays( new Date( 2026, 6, 1 ), 0 );
		expect( days[ 0 ].date ).toEqual( new Date( 2026, 5, 28 ) );
		expect( days.length % 7 ).toBe( 0 );
		expect( days[ days.length - 1 ].date ).toEqual(
			new Date( 2026, 7, 1 )
		);
	} );

	it( 'adds no padding to a month that fills whole weeks', () => {
		// February 2027 starts on a Monday and has 28 days.
		const days = getCalendarDays( new Date( 2027, 1, 1 ), 1 );
		expect( days ).toHaveLength( 28 );
		expect( days.every( ( day ) => day.isCurrentMonth ) ).toBe( true );
	} );

	it( 'places events on their local start dates, adjacent days included', () => {
		const events = [
			{ title: 'Inside', start: '2026-07-15T10:00:00' },
			{ title: 'Leading', start: '2026-06-30T10:00:00' },
		];
		const days = getCalendarDays( new Date( 2026, 6, 1 ), 1, events );
		expect( days[ 1 ].events.map( ( e ) => e.title ) ).toEqual( [
			'Leading',
		] );
		expect( days[ 16 ].events.map( ( e ) => e.title ) ).toEqual( [
			'Inside',
		] );
	} );

	it( 'spans the year boundary for December', () => {
		const { startDate, endDate } = getVisibleRange(
			new Date( 2026, 11, 1 ),
			1
		);
		expect( startDate ).toEqual( new Date( 2026, 10, 30 ) );
		expect( endDate ).toEqual( new Date( 2027, 0, 3 ) );
	} );
} );
