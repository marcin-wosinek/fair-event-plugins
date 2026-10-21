/**
 * @jest-environment jsdom
 *
 * Tests for the shared CalendarHeader, including the optional "Add event"
 * button (#1052).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import CalendarHeader from '../CalendarHeader.js';
import { labels } from './labels.js';

const currentDate = new Date( 2026, 6, 1 );

function renderHeader( props = {} ) {
	return render(
		<CalendarHeader
			currentDate={ currentDate }
			onPrevMonth={ () => {} }
			onNextMonth={ () => {} }
			onToday={ () => {} }
			labels={ labels }
			{ ...props }
		/>
	);
}

it( 'renders Previous, Today, Next, and Add event buttons', () => {
	renderHeader( { onAddEvent: () => {} } );
	for ( const name of [ 'Previous', 'Today', 'Next', 'Add event' ] ) {
		expect( screen.getByRole( 'button', { name } ) ).toBeInTheDocument();
	}
} );

it( 'omits Add event without a creation handler', () => {
	renderHeader();
	expect(
		screen.queryByRole( 'button', { name: 'Add event' } )
	).not.toBeInTheDocument();
} );

it( 'wraps the title and nav in a scoped header element for responsive styling', () => {
	const { container } = renderHeader();
	const header = container.querySelector( '.fair-events-calendar-header' );
	expect( header ).toBeInTheDocument();
	expect(
		header.querySelector( '.fair-events-calendar-title' )
	).toBeInTheDocument();
	expect(
		header.querySelector( '.fair-events-calendar-nav' )
	).toBeInTheDocument();
} );

it( 'calls the navigation and creation handlers', () => {
	const handlers = {
		onPrevMonth: jest.fn(),
		onNextMonth: jest.fn(),
		onToday: jest.fn(),
		onAddEvent: jest.fn(),
	};
	renderHeader( handlers );
	fireEvent.click( screen.getByRole( 'button', { name: 'Previous' } ) );
	fireEvent.click( screen.getByRole( 'button', { name: 'Next' } ) );
	fireEvent.click( screen.getByRole( 'button', { name: 'Today' } ) );
	fireEvent.click( screen.getByRole( 'button', { name: 'Add event' } ) );
	for ( const handler of Object.values( handlers ) ) {
		expect( handler ).toHaveBeenCalledTimes( 1 );
	}
} );
