/**
 * @jest-environment jsdom
 *
 * Tests for CalendarGrid's agenda empty state (#1168). The mobile agenda only
 * lists current-month days that have events, so a month without any would
 * otherwise render as a blank strip.
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import CalendarGrid from '../CalendarGrid.js';

const currentDate = new Date( 2026, 6, 1 );

function makeEvent( date ) {
	return {
		uid: 'standalone_1@example.com',
		title: 'Event',
		start: date.toISOString(),
	};
}

it( 'renders the empty state when the month has no events', () => {
	render(
		<CalendarGrid
			currentDate={ currentDate }
			events={ [] }
			onAddEvent={ () => {} }
			manageEventUrl=""
			startOfWeek={ 1 }
		/>
	);

	expect( screen.getByText( 'No events this month.' ) ).toBeInTheDocument();
} );

it( 'omits the empty state when the month has events', () => {
	render(
		<CalendarGrid
			currentDate={ currentDate }
			events={ [ makeEvent( new Date( 2026, 6, 15, 10, 0 ) ) ] }
			onAddEvent={ () => {} }
			manageEventUrl=""
			startOfWeek={ 1 }
		/>
	);

	expect(
		screen.queryByText( 'No events this month.' )
	).not.toBeInTheDocument();
} );

it( 'renders the empty state when only adjacent-month cells have events', () => {
	// July 2026 starts on a Wednesday, so the grid leads with Jun 29-30 —
	// cells the mobile agenda hides.
	render(
		<CalendarGrid
			currentDate={ currentDate }
			events={ [ makeEvent( new Date( 2026, 5, 30, 10, 0 ) ) ] }
			onAddEvent={ () => {} }
			manageEventUrl=""
			startOfWeek={ 1 }
		/>
	);

	expect( screen.getByText( 'No events this month.' ) ).toBeInTheDocument();
} );
