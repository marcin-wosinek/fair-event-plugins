/**
 * Tests for getLookupTiming (#2124).
 */
import { getLookupTiming } from '../lookupTiming.js';

// The reported Meetup event as an older shared parser returns it: combined
// site-local fields only (Europe/Madrid, already converted server-side).
const legacyMeetup = {
	title: 'Morning yoga in the park',
	start_datetime: '2026-11-02 10:00:00',
	end_datetime: '2026-11-02 11:00:00',
	all_day: false,
	location: 'Puente del Mar',
	source: 'schema',
	found: [ 'title', 'start', 'end', 'location' ],
};

describe( 'getLookupTiming', () => {
	it( 'reads the split fields of the current contract', () => {
		expect(
			getLookupTiming( {
				...legacyMeetup,
				start_date: '2026-11-02',
				start_time: '10:00:00',
				end_date: '2026-11-02',
				end_time: '11:00:00',
			} )
		).toEqual( {
			allDay: false,
			startDate: '2026-11-02',
			startTime: '10:00',
			endDate: '2026-11-02',
			endTime: '11:00',
		} );
	} );

	it( 'prefers the split fields over disagreeing combined ones', () => {
		expect(
			getLookupTiming( {
				start_datetime: '2026-11-01 09:00:00',
				start_date: '2026-11-02',
				start_time: '10:00:00',
			} )
		).toMatchObject( { startDate: '2026-11-02', startTime: '10:00' } );
	} );

	it( 'splits legacy combined site-local fields without shifting them', () => {
		expect( getLookupTiming( legacyMeetup ) ).toEqual( {
			allDay: false,
			startDate: '2026-11-02',
			startTime: '10:00',
			endDate: '2026-11-02',
			endTime: '11:00',
		} );
	} );

	it( 'keeps a late legacy time on its own day', () => {
		expect(
			getLookupTiming( {
				start_datetime: '2026-03-29 23:30:00',
				end_datetime: '2026-03-30 01:30:00',
			} )
		).toEqual( {
			allDay: false,
			startDate: '2026-03-29',
			startTime: '23:30',
			endDate: '2026-03-30',
			endTime: '01:30',
		} );
	} );

	it( 'does not invent a legacy end', () => {
		expect(
			getLookupTiming( {
				start_datetime: '2026-11-02 10:00:00',
				end_datetime: null,
			} )
		).toMatchObject( { endDate: '2026-11-02', endTime: '' } );
	} );

	it( 'reads a legacy all-day midnight as no time', () => {
		expect(
			getLookupTiming( {
				start_datetime: '2026-11-02 00:00:00',
				end_datetime: '2026-11-04 00:00:00',
				all_day: true,
			} )
		).toEqual( {
			allDay: true,
			startDate: '2026-11-02',
			startTime: '',
			endDate: '2026-11-04',
			endTime: '',
		} );
	} );

	it( 'keeps a deliberately null split time empty', () => {
		expect(
			getLookupTiming( {
				start_datetime: '2026-11-02 00:00:00',
				start_date: '2026-11-02',
				start_time: null,
				end_date: null,
				end_time: null,
				all_day: true,
			} )
		).toEqual( {
			allDay: true,
			startDate: '2026-11-02',
			startTime: '',
			endDate: '2026-11-02',
			endTime: '',
		} );
	} );

	it( 'does not fall back to combined fields when the split start is null', () => {
		expect(
			getLookupTiming( {
				start_date: null,
				start_datetime: '2026-11-02 10:00:00',
			} )
		).toBeNull();
	} );

	it.each( [
		[ 'no timing', { title: 'Only a title' } ],
		[ 'a malformed legacy start', { start_datetime: 'next Monday' } ],
		[ 'a malformed split start', { start_date: '02/11/2026' } ],
		[ 'no response', null ],
	] )( 'returns null for %s', ( label, metadata ) => {
		expect( getLookupTiming( metadata ) ).toBeNull();
	} );
} );
