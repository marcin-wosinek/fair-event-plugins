/**
 * @jest-environment jsdom
 *
 * Tests for the shared CalendarGrid: week starts, adjacent-month days, and the
 * agenda empty state (#1168). The mobile agenda only lists current-month days
 * that have events, so a month without any would otherwise render as a blank
 * strip.
 */
import '@testing-library/jest-dom';
import { render, screen, within, act } from '@testing-library/react';
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

describe( 'collapsing past days in the mobile agenda (#2446)', () => {
	let agendaMatches;
	let changeListeners;
	let originalMatchMedia;

	function mockMatchMedia() {
		window.matchMedia = jest.fn( ( query ) => ( {
			get matches() {
				return agendaMatches;
			},
			media: query,
			addEventListener: ( type, listener ) =>
				changeListeners.add( listener ),
			removeEventListener: ( type, listener ) =>
				changeListeners.delete( listener ),
		} ) );
	}

	function event( title, day, hour = 10, month = 10 ) {
		return {
			uid: `standalone_${ title.replace( /\W/g, '' ) }@example.com`,
			title,
			start: new Date( 2026, month, day, hour, 0 ).toISOString(),
		};
	}

	const november = new Date( 2026, 10, 1 );
	const novemberEvents = [
		event( 'First of month', 1 ),
		event( 'Yesterday event', 21 ),
		event( 'Earlier today', 22, 7 ),
		event( 'Later today', 22, 20 ),
		event( 'Tomorrow event', 23 ),
	];

	function renderCollapsible( props = {} ) {
		return renderGrid( {
			currentDate: november,
			events: novemberEvents,
			collapsePastDays: true,
			...props,
		} );
	}

	function disclosure( container ) {
		return container.querySelector( 'details.fair-events-calendar-past' );
	}

	function dayNumbersIn( element ) {
		return [
			...element.querySelectorAll(
				'.fair-events-calendar-day.has-events .fair-events-calendar-day-number'
			),
		].map( ( node ) => node.textContent );
	}

	beforeEach( () => {
		jest.useFakeTimers();
		// 22 November 2026, 12:00 browser-local time.
		jest.setSystemTime( new Date( 2026, 10, 22, 12, 0 ) );
		agendaMatches = true;
		changeListeners = new Set();
		originalMatchMedia = window.matchMedia;
		mockMatchMedia();
	} );

	afterEach( () => {
		jest.useRealTimers();
		window.matchMedia = originalMatchMedia;
	} );

	it( 'groups earlier current-month days into a collapsed disclosure', () => {
		const { container } = renderCollapsible();

		const details = disclosure( container );
		expect( details ).toBeInTheDocument();
		expect( details ).not.toHaveAttribute( 'open' );
		expect(
			within( details ).getByText( 'Past events', {
				selector: 'summary',
			} )
		).toBeInTheDocument();
		// The first of the month and yesterday are past.
		expect( dayNumbersIn( details ) ).toEqual( [ '1', '21' ] );
		expect( details ).toHaveTextContent( 'First of month' );
		expect( details ).toHaveTextContent( 'Yesterday event' );
	} );

	it( 'keeps all of today, including earlier events, and upcoming days outside', () => {
		const { container } = renderCollapsible();

		const details = disclosure( container );
		expect( details ).not.toHaveTextContent( 'Earlier today' );
		expect( details ).not.toHaveTextContent( 'Later today' );
		expect( details ).not.toHaveTextContent( 'Tomorrow event' );

		const days = container.querySelector( '.fair-events-calendar-days' );
		// The disclosure comes first, then today's card.
		expect( days.firstElementChild ).toBe( details );
		const todayCell = container.querySelector(
			'.fair-events-calendar-day.today'
		);
		expect( details.contains( todayCell ) ).toBe( false );
		expect( todayCell ).toHaveTextContent( 'Earlier today' );
		expect( todayCell ).toHaveTextContent( 'Later today' );
	} );

	it( 'keeps links and add actions on past days', () => {
		const pastWithUrl = {
			...event( 'Linked past', 10 ),
			url: 'https://example.com/past',
		};
		const onAddEvent = jest.fn();
		const { container } = renderCollapsible( {
			events: [ pastWithUrl, event( 'Tomorrow event', 23 ) ],
			onAddEvent,
		} );

		const details = disclosure( container );
		expect(
			within( details ).getByRole( 'link', { name: /Linked past/ } )
		).toHaveAttribute( 'href', 'https://example.com/past' );
		within( details ).getByRole( 'button', { name: 'Add event' } ).click();
		expect( onAddEvent ).toHaveBeenCalledWith( new Date( 2026, 10, 10 ) );
	} );

	it( 'omits the disclosure when no past day has events', () => {
		const { container } = renderCollapsible( {
			events: [
				event( 'Earlier today', 22, 7 ),
				event( 'Tomorrow', 23 ),
			],
		} );

		expect( disclosure( container ) ).not.toBeInTheDocument();
		expect( container ).toHaveTextContent( 'Earlier today' );
	} );

	it( 'keeps past-only months reachable through the disclosure', () => {
		const { container } = renderCollapsible( {
			events: [ event( 'Yesterday event', 21 ) ],
		} );

		expect( disclosure( container ) ).toHaveTextContent(
			'Yesterday event'
		);
		expect(
			screen.queryByText( 'No events this month.' )
		).not.toBeInTheDocument();
	} );

	it( 'ignores adjacent-month days', () => {
		// November 2026 starts on a Sunday, so a Monday-first grid leads
		// with 26–31 October.
		const { container } = renderCollapsible( {
			events: [ event( 'October event', 30, 10, 9 ), ...novemberEvents ],
		} );

		expect( disclosure( container ) ).not.toHaveTextContent(
			'October event'
		);
	} );

	it.each( [
		[ 'previous', new Date( 2026, 9, 1 ), 9 ],
		[ 'next', new Date( 2026, 11, 1 ), 11 ],
	] )( 'lists every day of the %s month', ( label, month, monthIndex ) => {
		const { container } = renderCollapsible( {
			currentDate: month,
			events: [ event( 'Early', 2, 10, monthIndex ) ],
		} );

		expect( disclosure( container ) ).not.toBeInTheDocument();
		expect( container ).toHaveTextContent( 'Early' );
	} );

	it( 'keeps the grid unchanged above the agenda breakpoint', () => {
		agendaMatches = false;
		const { container } = renderCollapsible();

		expect( disclosure( container ) ).not.toBeInTheDocument();
		// 26 October – 6 December: six full weeks, all in grid order.
		expect(
			container.querySelectorAll(
				'.fair-events-calendar-days > .fair-events-calendar-day'
			)
		).toHaveLength( 42 );
	} );

	it( 'follows the breakpoint when the viewport changes', () => {
		agendaMatches = false;
		const { container } = renderCollapsible();
		expect( disclosure( container ) ).not.toBeInTheDocument();

		agendaMatches = true;
		act( () => changeListeners.forEach( ( listener ) => listener() ) );

		expect( disclosure( container ) ).toBeInTheDocument();
	} );

	it( 'does not collapse without the opt-in (feed preview)', () => {
		const { container } = renderCollapsible( {
			collapsePastDays: undefined,
		} );

		expect( disclosure( container ) ).not.toBeInTheDocument();
		expect( window.matchMedia ).not.toHaveBeenCalled();
	} );

	it( 'does not collapse a forced grid', () => {
		const { container } = renderCollapsible( { forceGrid: true } );

		expect( disclosure( container ) ).not.toBeInTheDocument();
	} );
} );
