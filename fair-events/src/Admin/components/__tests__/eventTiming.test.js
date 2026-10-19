/**
 * Tests for the event timing summaries and checks (#1851).
 */
import {
	formatSiteLocalDate,
	formatSiteLocalTime,
} from 'fair-events-shared/src/dateTime.js';
import {
	formatEventTiming,
	getTimingError,
	isCalendarExportable,
} from '../eventTiming.js';

const timing = ( overrides ) => ( {
	start_date: '2026-10-18',
	end_date: '2026-10-18',
	start_time: null,
	end_time: null,
	all_day: false,
	...overrides,
} );

const date = ( value ) => formatSiteLocalDate( value );
const time = ( value ) => formatSiteLocalTime( `2026-10-18 ${ value }` );

describe( 'formatEventTiming', () => {
	test( 'shows only the supplied times of a single day', () => {
		expect( formatEventTiming( timing() ) ).toBe( date( '2026-10-18' ) );
		expect(
			formatEventTiming( timing( { start_time: '10:00:00' } ) )
		).toBe( `${ date( '2026-10-18' ) }, ${ time( '10:00:00' ) }` );
		expect( formatEventTiming( timing( { end_time: '12:00:00' } ) ) ).toBe(
			`${ date( '2026-10-18' ) }, ends ${ time( '12:00:00' ) }`
		);
		expect(
			formatEventTiming(
				timing( { start_time: '10:00:00', end_time: '12:00:00' } )
			)
		).toBe(
			`${ date( '2026-10-18' ) }, ${ time( '10:00:00' ) } – ${ time(
				'12:00:00'
			) }`
		);
	} );

	test( 'puts each supplied time next to its own day across several days', () => {
		const multi = { end_date: '2026-10-20' };
		expect( formatEventTiming( timing( multi ) ) ).toBe(
			`${ date( '2026-10-18' ) } – ${ date( '2026-10-20' ) }`
		);
		expect(
			formatEventTiming( timing( { ...multi, start_time: '10:00:00' } ) )
		).toBe(
			`${ date( '2026-10-18' ) } ${ time( '10:00:00' ) } – ${ date(
				'2026-10-20'
			) }`
		);
		expect(
			formatEventTiming( timing( { ...multi, end_time: '17:00:00' } ) )
		).toBe(
			`${ date( '2026-10-18' ) } – ends ${ date( '2026-10-20' ) } ${ time(
				'17:00:00'
			) }`
		);
	} );

	test( 'keeps genuine midnight and never labels missing times all day', () => {
		expect(
			formatEventTiming(
				timing( { start_time: '00:00:00', end_time: '02:00:00' } )
			)
		).toBe(
			`${ date( '2026-10-18' ) }, ${ time( '00:00:00' ) } – ${ time(
				'02:00:00'
			) }`
		);
		expect( formatEventTiming( timing() ) ).not.toMatch( /all day/i );
	} );

	test( 'ignores times of an all-day date and is empty when undated', () => {
		expect(
			formatEventTiming(
				timing( { all_day: true, start_time: '10:00:00' } )
			)
		).toBe( date( '2026-10-18' ) );
		expect( formatEventTiming( { start_date: null } ) ).toBe( '' );
		expect( formatEventTiming( null ) ).toBe( '' );
	} );
} );

describe( 'isCalendarExportable', () => {
	test( 'needs both times unless the date is all day', () => {
		expect( isCalendarExportable( timing() ) ).toBe( false );
		expect(
			isCalendarExportable( timing( { start_time: '10:00' } ) )
		).toBe( false );
		expect( isCalendarExportable( timing( { end_time: '12:00' } ) ) ).toBe(
			false
		);
		expect(
			isCalendarExportable(
				timing( { start_time: '10:00', end_time: '12:00' } )
			)
		).toBe( true );
		expect( isCalendarExportable( timing( { all_day: true } ) ) ).toBe(
			true
		);
		expect( isCalendarExportable( { start_date: null } ) ).toBe( false );
	} );
} );

describe( 'getTimingError', () => {
	const fields = ( overrides ) => ( {
		startDate: '2026-10-18',
		endDate: '2026-10-18',
		startTime: '',
		endTime: '',
		allDay: false,
		...overrides,
	} );

	test( 'accepts every combination of missing times', () => {
		expect( getTimingError( fields() ) ).toBeNull();
		expect( getTimingError( fields( { startTime: '10:00' } ) ) ).toBeNull();
		expect( getTimingError( fields( { endTime: '09:00' } ) ) ).toBeNull();
		expect(
			getTimingError( fields( { startTime: '10:00', endTime: '12:00' } ) )
		).toBeNull();
	} );

	test( 'rejects an end date before the start date, whatever the times', () => {
		expect( getTimingError( fields( { endDate: '2026-10-17' } ) ) ).toBe(
			'The end date is before the start date.'
		);
	} );

	test( 'compares times only when both are supplied on one day', () => {
		expect(
			getTimingError( fields( { startTime: '12:00', endTime: '10:00' } ) )
		).toBe( 'The end time is before the start time on the same day.' );
		// Overnight across two days is fine.
		expect(
			getTimingError(
				fields( {
					endDate: '2026-10-19',
					startTime: '22:00',
					endTime: '02:00',
				} )
			)
		).toBeNull();
		// A missing time is never treated as midnight.
		expect( getTimingError( fields( { endTime: '00:00' } ) ) ).toBeNull();
		// All-day dates have no times to compare.
		expect(
			getTimingError(
				fields( { allDay: true, startTime: '12:00', endTime: '10:00' } )
			)
		).toBeNull();
	} );

	test( 'requires a start date when asked, or when anything else is set', () => {
		expect(
			getTimingError( fields( { startDate: '' } ), { requireDate: true } )
		).toBe( 'Enter a start date.' );
		expect(
			getTimingError( fields( { startDate: '', endDate: '' } ) )
		).toBeNull();
		expect(
			getTimingError(
				fields( { startDate: '', endDate: '', startTime: '10:00' } )
			)
		).toBe( 'Enter a start date, or clear the end date and times.' );
	} );
} );
