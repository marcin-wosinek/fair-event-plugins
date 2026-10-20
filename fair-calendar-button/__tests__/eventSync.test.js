import {
	eventLocation,
	primaryEventDate,
	toCalendarTiming,
} from '../src/blocks/calendar-button/utils/eventSync.js';

describe( 'toCalendarTiming', () => {
	it( 'maps a timed event to site-local date-times', () => {
		expect(
			toCalendarTiming( {
				start_date: '2030-06-14',
				end_date: '2030-06-14',
				start_time: '19:00:00',
				end_time: '21:30:00',
				all_day: false,
			} )
		).toEqual( {
			start: '2030-06-14T19:00',
			end: '2030-06-14T21:30',
			allDay: false,
		} );
	} );

	it( 'maps an all-day event to its inclusive dates', () => {
		expect(
			toCalendarTiming( {
				start_date: '2030-06-14',
				end_date: '2030-06-16',
				start_time: null,
				end_time: null,
				all_day: true,
			} )
		).toEqual( { start: '2030-06-14', end: '2030-06-16', allDay: true } );
	} );

	it( 'uses the start date when the end date is missing', () => {
		expect(
			toCalendarTiming( {
				start_date: '2030-06-14',
				end_date: null,
				all_day: true,
			} )
		).toEqual( { start: '2030-06-14', end: '2030-06-14', allDay: true } );
	} );

	it.each( [
		[ 'no start date', { start_date: null, all_day: true } ],
		[
			'no end time',
			{
				start_date: '2030-06-14',
				start_time: '19:00:00',
				end_time: null,
			},
		],
		[
			'no start time',
			{
				start_date: '2030-06-14',
				start_time: null,
				end_time: '21:00:00',
			},
		],
		[ 'no times and not all-day', { start_date: '2030-06-14' } ],
	] )( 'never invents timing for %s', ( _label, eventDate ) => {
		expect( toCalendarTiming( eventDate ) ).toBeNull();
	} );
} );

describe( 'eventLocation', () => {
	const eventDate = { address: 'Plaza Mayor 1' };

	it( 'prefers the venue name and address', () => {
		expect(
			eventLocation( eventDate, {
				name: 'Town Hall',
				address: 'Main St 2',
			} )
		).toBe( 'Town Hall, Main St 2' );
	} );

	it( 'uses the venue name alone when it has no address', () => {
		expect( eventLocation( eventDate, { name: 'Town Hall' } ) ).toBe(
			'Town Hall'
		);
	} );

	it( 'falls back to the inline address without a venue', () => {
		expect( eventLocation( eventDate, null ) ).toBe( 'Plaza Mayor 1' );
	} );

	it( 'is empty when the event has no location', () => {
		expect( eventLocation( {}, null ) ).toBe( '' );
	} );
} );

describe( 'primaryEventDate', () => {
	it( 'picks the dated single or series row before others', () => {
		const rows = [
			{ id: 3, occurrence_type: 'generated', start_date: '2030-01-01' },
			{ id: 1, occurrence_type: 'single', start_date: null },
			{ id: 2, occurrence_type: 'master', start_date: '2030-02-01' },
		];
		expect( primaryEventDate( rows ).id ).toBe( 2 );
	} );

	it( 'is null without a single or series row', () => {
		expect( primaryEventDate( [] ) ).toBeNull();
		expect(
			primaryEventDate( [ { id: 1, occurrence_type: 'generated' } ] )
		).toBeNull();
		expect( primaryEventDate( undefined ) ).toBeNull();
	} );
} );
