/**
 * @jest-environment jsdom
 *
 * Tests for the shared CalendarGrid: week starts, adjacent-month days, and the
 * agenda empty state (#1168). The mobile agenda only lists current-month days
 * that have events, so a month without any would otherwise render as a blank
 * strip.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import CalendarGrid from '../CalendarGrid.js';
import { labels } from './labels.js';

const currentDate = new Date( 2026, 6, 1 );

function makeEvent( date ) {
	return {
		uid: 'standalone_1@example.com',
		title: 'Event',
		start: date.toISOString(),
	};
}

function renderGrid( props = {} ) {
	return render(
		<CalendarGrid
			currentDate={ currentDate }
			events={ [] }
			startOfWeek={ 1 }
			showEmptyMessage
			labels={ labels }
			{ ...props }
		/>
	);
}

it( 'renders the empty state when the month has no events', () => {
	renderGrid();

	expect( screen.getByText( 'No events this month.' ) ).toBeInTheDocument();
} );

it( 'omits the empty state when the month has events', () => {
	renderGrid( { events: [ makeEvent( new Date( 2026, 6, 15, 10, 0 ) ) ] } );

	expect(
		screen.queryByText( 'No events this month.' )
	).not.toBeInTheDocument();
} );

it( 'renders the empty state when only adjacent-month cells have events', () => {
	// July 2026 starts on a Wednesday, so the grid leads with Jun 29-30 —
	// cells the mobile agenda hides.
	renderGrid( { events: [ makeEvent( new Date( 2026, 5, 30, 10, 0 ) ) ] } );

	expect( screen.getByText( 'No events this month.' ) ).toBeInTheDocument();
} );

it( 'omits the empty state until the consumer reports a successful load', () => {
	renderGrid( { showEmptyMessage: false } );

	expect(
		screen.queryByText( 'No events this month.' )
	).not.toBeInTheDocument();
} );

it( 'keeps the dated grid without the agenda message when forced', () => {
	const { container } = renderGrid( { forceGrid: true } );

	expect(
		container.querySelector( '.fair-events-calendar-grid' )
	).toHaveClass( 'is-grid-forced' );
	expect(
		screen.queryByText( 'No events this month.' )
	).not.toBeInTheDocument();
} );

it.each( [
	[ 1, 'Mon', 35 ],
	[ 0, 'Sun', 35 ],
] )(
	'starts weeks on day %p with adjacent-month cells',
	( startOfWeek, firstLabel, cellCount ) => {
		const { container } = renderGrid( { startOfWeek } );

		const weekdays = container.querySelectorAll(
			'.fair-events-calendar-weekday'
		);
		expect( weekdays[ 0 ].textContent ).toMatch(
			new RegExp( `^${ firstLabel }` )
		);
		expect(
			container.querySelectorAll( '.fair-events-calendar-day' )
		).toHaveLength( cellCount );
		expect(
			container.querySelectorAll(
				'.fair-events-calendar-day.other-month'
			).length
		).toBeGreaterThan( 0 );
	}
);

it( 'marks today', () => {
	const today = new Date();
	const { container } = renderGrid( { currentDate: today } );

	const todayCell = container.querySelector(
		'.fair-events-calendar-day.today'
	);
	expect(
		todayCell.querySelector( '.fair-events-calendar-day-number' )
			.textContent
	).toBe( String( today.getDate() ) );
} );

it( 'renders no add buttons without a creation handler', () => {
	renderGrid();

	expect(
		screen.queryByRole( 'button', { name: 'Add event' } )
	).not.toBeInTheDocument();
} );
