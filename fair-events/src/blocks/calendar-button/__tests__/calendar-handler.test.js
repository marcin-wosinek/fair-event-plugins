/**
 * Runs in a UTC+12 timezone, where UTC noon is local midnight, which
 * calendar-link >= 2.11.6 reads as the local calendar day for all-day events.
 *
 * @jest-environment ./src/blocks/calendar-button/__tests__/helpers/timezoneEnvironment.cjs
 * @timezone Pacific/Auckland
 */

import { google, ics, outlook, yahoo } from 'calendar-link';
import { createEventData } from '../utils/calendar-handler.js';

describe( 'createEventData', () => {
	describe( 'all-day events in a UTC+12 timezone', () => {
		it( 'keeps a single-day event on its calendar date', () => {
			const eventData = createEventData( {
				start: '2026-07-15 00:00:00',
				end: '2026-07-15 23:59:59',
				allDay: true,
				title: 'Workshop',
			} );

			expect( google( eventData ) ).toContain(
				'dates=20260715%2F20260716'
			);
			expect( yahoo( eventData ) ).toContain( 'st=20260715' );
			expect( yahoo( eventData ) ).toContain( 'et=20260716' );
			expect( outlook( eventData ) ).toContain(
				'startdt=2026-07-15T00%3A00%3A00'
			);
			expect( decodeURIComponent( ics( eventData ) ) ).toContain(
				'DTSTART:20260715'
			);
			expect( eventData.start ).toBe( '2026-07-15' );
			expect( eventData.end ).toBe( '2026-07-16' );
		} );

		it( 'makes the end date of a multi-day event inclusive', () => {
			const eventData = createEventData( {
				start: '2026-12-30',
				end: '2027-01-01',
				allDay: true,
				title: 'Retreat',
			} );

			expect( eventData.start ).toBe( '2026-12-30' );
			expect( eventData.end ).toBe( '2027-01-02' );
			expect( google( eventData ) ).toContain(
				'dates=20261230%2F20270102'
			);
		} );

		it( 'keeps the end date when it equals the start date', () => {
			const eventData = createEventData( {
				start: '2026-07-15',
				end: '2026-07-15',
				allDay: true,
			} );

			expect( eventData.end ).toBe( '2026-07-15' );
		} );
	} );

	it( 'passes timed events through as Date objects', () => {
		const eventData = createEventData( {
			start: '2026-07-15T10:00:00Z',
			end: '2026-07-15T11:30:00Z',
			allDay: false,
		} );

		expect( eventData.start ).toEqual( new Date( '2026-07-15T10:00:00Z' ) );
		expect( eventData.end ).toEqual( new Date( '2026-07-15T11:30:00Z' ) );
		expect( google( eventData ) ).toContain(
			'dates=20260715T100000Z%2F20260715T113000Z'
		);
	} );
} );
