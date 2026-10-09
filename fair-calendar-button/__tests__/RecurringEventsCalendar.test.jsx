/**
 * Runs in a timezone behind UTC, where a date-only until value parsed as UTC
 * would highlight the day before the real end date.
 *
 * @jest-environment ./__tests__/helpers/timezoneEnvironment.cjs
 * @timezone America/New_York
 */

import { render } from '@testing-library/react';
import RecurringEventsCalendar from '../src/blocks/calendar-button/components/RecurringEventsCalendar.js';

/**
 * Find the calendar cell for a day of the displayed month.
 *
 * @param {HTMLElement} container Rendered container.
 * @param {number}      day       Day of the month.
 * @return {HTMLElement|undefined} Calendar day cell.
 */
function dayCell( container, day ) {
	return Array.from( container.querySelectorAll( '.calendar-day' ) ).find(
		( cell ) => cell.textContent === String( day )
	);
}

describe( 'RecurringEventsCalendar', () => {
	beforeEach( () => {
		jest.useFakeTimers();
		jest.setSystemTime( new Date( 2024, 0, 10, 12 ) );
	} );

	afterEach( () => {
		jest.useRealTimers();
	} );

	it( 'highlights a timed occurrence on the until day as the last one', () => {
		const { container } = render(
			<RecurringEventsCalendar
				startDate="2024-01-01T10:00"
				recurrence={ {
					frequency: 'WEEKLY',
					count: null,
					until: '2024-01-15',
				} }
			/>
		);

		const occurrenceDays = Array.from(
			container.querySelectorAll( '.calendar-day.has-event' )
		).map( ( cell ) => cell.textContent );
		expect( occurrenceDays ).toEqual( [ '1', '8', '15' ] );

		const untilDay = dayCell( container, 15 );
		expect( untilDay.className ).toBe(
			'calendar-day has-event is-end-date'
		);
		expect( untilDay.title ).toBe(
			'Event occurs on this day (last occurrence)'
		);
		expect( dayCell( container, 14 ).className ).toBe( 'calendar-day' );
		expect( container.textContent ).toContain(
			'3 event occurrences in this month'
		);
	} );

	it( 'marks an until day without an occurrence as the end date only', () => {
		const { container } = render(
			<RecurringEventsCalendar
				startDate="2024-01-01T10:00"
				recurrence={ {
					frequency: 'WEEKLY',
					count: null,
					until: '2024-01-17',
				} }
			/>
		);

		expect( dayCell( container, 15 ).className ).toBe(
			'calendar-day has-event'
		);
		expect( dayCell( container, 17 ).className ).toBe(
			'calendar-day is-end-date'
		);
	} );
} );
