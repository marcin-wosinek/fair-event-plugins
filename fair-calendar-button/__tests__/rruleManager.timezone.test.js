/**
 * Runs in a timezone behind UTC with daylight saving time, where a date-only
 * string parsed as UTC lands on the previous local day.
 *
 * @jest-environment ./__tests__/helpers/timezoneEnvironment.cjs
 * @timezone America/New_York
 */

import { rruleManager } from '../src/blocks/calendar-button/utils/rruleManager.js';

describe( 'RRuleManager in America/New_York', () => {
	it( 'runs in the requested timezone', () => {
		expect( new Date( 2024, 0, 1 ).getTimezoneOffset() ).toBe( 300 );
		expect( new Date( 2024, 6, 1 ).getTimezoneOffset() ).toBe( 240 );
	} );

	it( 'keeps a date-only start on its own day', () => {
		const events = rruleManager.generateEvents(
			{ frequency: 'WEEKLY', count: 3 },
			'2024-01-01'
		);

		expect( events ).toEqual( [
			new Date( 2024, 0, 1 ),
			new Date( 2024, 0, 8 ),
			new Date( 2024, 0, 15 ),
		] );
	} );

	it( 'includes a late-evening occurrence on the until date', () => {
		const events = rruleManager.generateEvents(
			{ frequency: 'WEEKLY', until: '2024-01-15' },
			'2024-01-01T22:30'
		);

		expect( events ).toEqual( [
			new Date( 2024, 0, 1 ),
			new Date( 2024, 0, 8 ),
			new Date( 2024, 0, 15 ),
		] );
	} );

	it( 'keeps daily dates consecutive across the spring-forward gap', () => {
		// 02:30 does not exist on 2024-03-10 in this timezone.
		const events = rruleManager.generateEvents(
			{ frequency: 'DAILY', until: '2024-03-11' },
			'2024-03-08T02:30'
		);

		expect( events ).toEqual( [
			new Date( 2024, 2, 8 ),
			new Date( 2024, 2, 9 ),
			new Date( 2024, 2, 10 ),
			new Date( 2024, 2, 11 ),
		] );
	} );

	it( 'keeps weekly dates on the same weekday across the fall-back change', () => {
		const events = rruleManager.generateEvents(
			{ frequency: 'WEEKLY', until: '2024-11-10' },
			'2024-10-27T01:30'
		);

		expect( events ).toEqual( [
			new Date( 2024, 9, 27 ),
			new Date( 2024, 10, 3 ),
			new Date( 2024, 10, 10 ),
		] );
	} );
} );
