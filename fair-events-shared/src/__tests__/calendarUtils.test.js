/**
 * Tests for groupEventsByDate (#1851): events with canonical dates are
 * placed by those dates, whatever their times and the browser timezone.
 */
import { groupEventsByDate } from '../calendarUtils.js';

describe( 'groupEventsByDate', () => {
	test( 'places a date-only event on its date although it has no start', () => {
		const event = {
			uid: 'a',
			start: null,
			end: null,
			start_date: '2026-10-18',
			end_date: '2026-10-18',
		};
		expect( groupEventsByDate( [ event ] ) ).toEqual( {
			'2026-10-18': [ event ],
		} );
	} );

	test( 'covers every day of a multi-day event missing its times', () => {
		const event = {
			uid: 'b',
			start: null,
			end: '2026-10-22T17:00:00+02:00',
			start_date: '2026-10-20',
			end_date: '2026-10-22',
		};
		expect( Object.keys( groupEventsByDate( [ event ] ) ) ).toEqual( [
			'2026-10-20',
			'2026-10-21',
			'2026-10-22',
		] );
	} );

	test( 'ignores a timestamp offset that would move the day', () => {
		// 23:30 site time in UTC+14 is the previous day in most browsers.
		const event = {
			uid: 'c',
			start: '2026-10-18T23:30:00+14:00',
			end: null,
			start_date: '2026-10-18',
			end_date: '2026-10-18',
		};
		expect( Object.keys( groupEventsByDate( [ event ] ) ) ).toEqual( [
			'2026-10-18',
		] );
	} );

	test( 'falls back to timestamps for events without canonical dates', () => {
		const event = { uid: 'd', start: '2026-10-18T10:00:00', end: null };
		expect( Object.keys( groupEventsByDate( [ event ] ) ) ).toEqual( [
			'2026-10-18',
		] );
		expect( groupEventsByDate( [ { uid: 'e', start: null } ] ) ).toEqual(
			{}
		);
	} );
} );
