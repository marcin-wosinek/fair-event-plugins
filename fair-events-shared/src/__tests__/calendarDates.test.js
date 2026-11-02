/**
 * Tests for the date-only calendar helpers shared by Fair Events and Fair
 * Calendar Button (#2089).
 */
import {
	isValidDateString,
	addCalendarDays,
	differenceInCalendarDays,
	calculateDaysInclusive,
	calculateEndDate,
} from '../calendarDates.js';

describe( 'isValidDateString', () => {
	test.each( [ '2026-10-27', '2024-02-29', '0002-01-01', '9999-12-31' ] )(
		'accepts %s',
		( value ) => {
			expect( isValidDateString( value ) ).toBe( true );
		}
	);

	test.each( [
		'',
		null,
		undefined,
		'2025-02-29',
		'2026-13-01',
		'2026-04-31',
		'2026-1-5',
		'27/10/2026',
		'2026-10-27T10:00',
		'invalid-date',
	] )( 'rejects %p', ( value ) => {
		expect( isValidDateString( value ) ).toBe( false );
	} );
} );

describe( 'addCalendarDays', () => {
	test.each( [
		[ '2026-10-27', 1, '2026-10-28' ],
		[ '2026-10-27', -1, '2026-10-26' ],
		[ '2026-10-27', 17, '2026-11-13' ],
		[ '2026-10-31', 1, '2026-11-01' ],
		[ '2026-12-31', 1, '2027-01-01' ],
		[ '2027-01-01', -1, '2026-12-31' ],
		[ '2024-02-28', 1, '2024-02-29' ],
		[ '2024-02-29', 365, '2025-02-28' ],
		[ '2025-02-28', 1, '2025-03-01' ],
		[ '2026-10-27', 0, '2026-10-27' ],
	] )( '%s %+d days is %s', ( date, days, expected ) => {
		expect( addCalendarDays( date, days ) ).toBe( expected );
	} );

	test( 'keeps two-digit years instead of mapping them to the 1900s', () => {
		expect( addCalendarDays( '0026-10-27', 1 ) ).toBe( '0026-10-28' );
	} );

	test( 'returns empty for an invalid date or day count', () => {
		expect( addCalendarDays( '', 1 ) ).toBe( '' );
		expect( addCalendarDays( '2025-02-29', 1 ) ).toBe( '' );
		expect( addCalendarDays( '2026-10-27', 1.5 ) ).toBe( '' );
		expect( addCalendarDays( '2026-10-27', NaN ) ).toBe( '' );
		expect( addCalendarDays( '9999-12-31', 1 ) ).toBe( '' );
	} );
} );

describe( 'differenceInCalendarDays', () => {
	test.each( [
		[ '2026-10-27', '2026-10-27', 0 ],
		[ '2026-10-28', '2026-10-27', 1 ],
		[ '2026-10-27', '2026-10-28', -1 ],
		[ '2027-01-01', '2026-12-31', 1 ],
		[ '2024-03-01', '2024-02-28', 2 ],
		[ '2025-03-01', '2025-02-28', 1 ],
	] )( '%s minus %s is %d', ( later, earlier, expected ) => {
		expect( differenceInCalendarDays( later, earlier ) ).toBe( expected );
	} );

	test( 'returns null for an invalid date', () => {
		expect( differenceInCalendarDays( '', '2026-10-27' ) ).toBeNull();
		expect( differenceInCalendarDays( '2026-10-27', 'x' ) ).toBeNull();
	} );
} );

describe( 'daylight-saving transitions', () => {
	// Days around the 2026 European and US transitions. The arithmetic runs
	// on UTC midnights, so the browser zone (Europe/Madrid for La Mutable)
	// can never add or drop a day here.
	test.each( [
		[ '2026-03-28', '2026-03-30', 2 ],
		[ '2026-10-24', '2026-10-26', 2 ],
		[ '2026-03-07', '2026-03-09', 2 ],
		[ '2026-10-31', '2026-11-02', 2 ],
	] )( '%s to %s is %d days', ( start, end, days ) => {
		expect( differenceInCalendarDays( end, start ) ).toBe( days );
		expect( addCalendarDays( start, days ) ).toBe( end );
		expect( addCalendarDays( end, -days ) ).toBe( start );
	} );

	test( 'every day of a year round-trips by one day', () => {
		let date = '2026-01-01';
		for ( let i = 0; i < 365; i++ ) {
			const next = addCalendarDays( date, 1 );
			expect( differenceInCalendarDays( next, date ) ).toBe( 1 );
			expect( addCalendarDays( next, -1 ) ).toBe( date );
			date = next;
		}
		expect( date ).toBe( '2027-01-01' );
	} );
} );

describe( 'calculateDaysInclusive / calculateEndDate', () => {
	test( 'count the start day', () => {
		expect( calculateDaysInclusive( '2026-10-27', '2026-10-27' ) ).toBe(
			1
		);
		expect( calculateDaysInclusive( '2026-10-31', '2026-11-02' ) ).toBe(
			3
		);
		expect( calculateEndDate( '2026-10-31', 3 ) ).toBe( '2026-11-02' );
		expect( calculateEndDate( '2026-10-31', '1' ) ).toBe( '2026-10-31' );
	} );

	test( 'keep the previous edge-case results', () => {
		expect( calculateDaysInclusive( '2024-12-22', '2024-12-21' ) ).toBe(
			0
		);
		expect( calculateDaysInclusive( '', '2024-12-21' ) ).toBeNull();
		expect( calculateEndDate( '2024-12-21', 'other' ) ).toBe( '' );
		expect( calculateEndDate( '2024-12-21', null ) ).toBe( '' );
		expect( calculateEndDate( 'invalid-date', '2' ) ).toBe( '' );
	} );
} );
