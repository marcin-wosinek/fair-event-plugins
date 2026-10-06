/**
 * @jest-environment jsdom
 *
 * Tests for SeriesModal's "Regular schedule" and "Irregular series" tabs
 * (#979, #1127).
 *
 * Covers:
 *   - Regular tab: a display-only calendar highlights every rule-generated
 *     date and a compact "N dates, until <date>" summary line replaces the
 *     old text list.
 *   - Irregular tab: seeding the selection from existing generated
 *     occurrences, the master's own date is fixed (disabled button, can't be
 *     toggled), clicking an unselected day adds it and clicking a selected
 *     day removes it, and confirm still sends
 *     { recurrence_mode: 'manual', manual_dates }.
 *   - Both tabs (#1750): the calendar always shows two consecutive months,
 *     schedule edits and date toggles never change or reset the viewed
 *     months, each tab remembers its own, and paging leaves the save payload
 *     untouched.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import { formatDateOnly } from 'fair-events-shared';
import SeriesModal from '../SeriesModal.js';

jest.mock( '@wordpress/api-fetch' );

// Matches the full-date aria-label MiniCalendar builds by default.
function fullDateLabel( dateStr ) {
	return formatDateOnly( dateStr, 'long' );
}

beforeEach( () => {
	// The Regular schedule tab renders RecurrenceControl, which uses
	// @wordpress/components' deprecated 36px default SelectControl/
	// NumberControl size, and TabPanel (ariakit) commits its tab ids in a
	// post-mount effect — both emit console noise unrelated to what these
	// tests exercise. Matches the suppression convention in
	// ManageEventApp.test.jsx.
	jest.spyOn( console, 'warn' ).mockImplementation( () => {} );
	jest.spyOn( console, 'error' ).mockImplementation( () => {} );

	// jsdom has no layout engine; @wordpress/components' HStack/Button use
	// matchMedia for responsive spacing, which jsdom doesn't implement.
	window.matchMedia =
		window.matchMedia ||
		function () {
			return {
				matches: false,
				addListener: () => {},
				removeListener: () => {},
			};
		};
} );

afterEach( () => {
	jest.restoreAllMocks();
} );

// TabPanel (ariakit) sets up its tab ids in an effect after mount; flushing a
// tick via waitFor keeps that update wrapped in act() before we interact.
async function renderModal( props ) {
	const utils = render( <SeriesModal { ...props } /> );
	await waitFor( () =>
		expect(
			screen.getByRole( 'tab', { name: 'Regular schedule' } )
		).toBeInTheDocument()
	);
	return utils;
}

function openIrregularTab() {
	fireEvent.click( screen.getByRole( 'tab', { name: 'Irregular series' } ) );
}

it( 'Regular tab shows a display-only calendar and a compact dates summary', async () => {
	await renderModal( {
		eventDateId: 1,
		initialRrule: null,
		initialRecurrenceMode: null,
		startDatetime: '2026-07-01 18:00:00',
		generatedOccurrences: [],
		onClose: () => {},
		onSaved: () => {},
		onImpact: () => {},
	} );

	// Default recurrence is weekly, 10 occurrences (DEFAULT_RECURRENCE).
	expect( screen.getByText( 'July 2026' ) ).toBeInTheDocument();
	expect( screen.getByText( /10 dates, until/ ) ).toBeInTheDocument();

	// Display-only: no toggle buttons in the calendar (aria-pressed is only
	// used by the Irregular tab's picker).
	expect( screen.queryAllByRole( 'button', { pressed: true } ) ).toHaveLength(
		0
	);
	expect(
		screen.queryAllByRole( 'button', { pressed: false } )
	).toHaveLength( 0 );
} );

it( 'seeds the calendar selection from existing generated occurrences when editing a manual series', async () => {
	await renderModal( {
		eventDateId: 1,
		initialRrule: null,
		initialRecurrenceMode: 'manual',
		startDatetime: '2026-07-01 18:00:00',
		generatedOccurrences: [
			{ id: 2, start_datetime: '2026-07-08 18:00:00' },
			{ id: 3, start_datetime: '2026-07-20 18:00:00' },
		],
		onClose: () => {},
		onSaved: () => {},
		onImpact: () => {},
	} );

	openIrregularTab();

	const masterButton = screen.getByRole( 'button', {
		name: fullDateLabel( '2026-07-01' ),
	} );
	expect( masterButton ).toBeDisabled();
	expect( masterButton ).toHaveAttribute( 'aria-pressed', 'true' );

	expect(
		screen.getByRole( 'button', { name: fullDateLabel( '2026-07-08' ) } )
	).toHaveAttribute( 'aria-pressed', 'true' );
	expect(
		screen.getByRole( 'button', { name: fullDateLabel( '2026-07-20' ) } )
	).toHaveAttribute( 'aria-pressed', 'true' );
	expect(
		screen.getByRole( 'button', { name: fullDateLabel( '2026-07-15' ) } )
	).toHaveAttribute( 'aria-pressed', 'false' );

	expect( screen.getByText( '3 dates selected' ) ).toBeInTheDocument();
} );

it( 'clicking an unselected day adds it and clicking it again removes it, keeping the master date fixed', async () => {
	await renderModal( {
		eventDateId: 1,
		initialRrule: null,
		initialRecurrenceMode: null,
		startDatetime: '2026-07-01 18:00:00',
		generatedOccurrences: [],
		onClose: () => {},
		onSaved: () => {},
		onImpact: () => {},
	} );

	openIrregularTab();

	const masterButton = screen.getByRole( 'button', {
		name: fullDateLabel( '2026-07-01' ),
	} );
	expect( masterButton ).toBeDisabled();
	expect( screen.getByText( '1 dates selected' ) ).toBeInTheDocument();

	fireEvent.click( masterButton );
	expect( screen.getByText( '1 dates selected' ) ).toBeInTheDocument();

	const dayButton = screen.getByRole( 'button', {
		name: fullDateLabel( '2026-07-05' ),
	} );
	expect( dayButton ).toHaveAttribute( 'aria-pressed', 'false' );

	fireEvent.click( dayButton );
	expect( dayButton ).toHaveAttribute( 'aria-pressed', 'true' );
	expect( screen.getByText( '2 dates selected' ) ).toBeInTheDocument();

	fireEvent.click( dayButton );
	expect( dayButton ).toHaveAttribute( 'aria-pressed', 'false' );
	expect( screen.getByText( '1 dates selected' ) ).toBeInTheDocument();
} );

it( 'sends recurrence_mode + manual_dates on confirm from the Irregular tab', async () => {
	apiFetch.mockResolvedValue( {
		recurrence_mode: 'manual',
		generated_occurrences: [],
	} );

	const onSaved = jest.fn();

	await renderModal( {
		eventDateId: 7,
		initialRrule: null,
		initialRecurrenceMode: null,
		startDatetime: '2026-07-01 18:00:00',
		generatedOccurrences: [],
		onClose: () => {},
		onSaved,
		onImpact: () => {},
	} );

	openIrregularTab();
	fireEvent.click(
		screen.getByRole( 'button', { name: fullDateLabel( '2026-07-15' ) } )
	);

	fireEvent.click( screen.getByRole( 'button', { name: /Create series/ } ) );

	await waitFor( () => expect( onSaved ).toHaveBeenCalled() );

	expect( apiFetch ).toHaveBeenCalledWith(
		expect.objectContaining( {
			path: '/fair-events/v1/event-dates/7',
			method: 'PUT',
			data: {
				recurrence_mode: 'manual',
				manual_dates: [ '2026-07-01', '2026-07-15' ],
			},
		} )
	);
} );

describe( 'stable two-month calendar', () => {
	const septemberProps = {
		eventDateId: 9,
		initialRrule: null,
		initialRecurrenceMode: null,
		startDatetime: '2026-09-01 18:00:00',
		generatedOccurrences: [],
		onClose: () => {},
		onSaved: () => {},
		onImpact: () => {},
	};

	function monthLabels() {
		return screen
			.getAllByText( /^[A-Z][a-z]+ \d{4}$/ )
			.map( ( node ) => node.textContent );
	}

	function setOccurrenceCount( count ) {
		fireEvent.change(
			screen.getByRole( 'spinbutton', {
				name: 'Number of occurrences',
			} ),
			{ target: { value: String( count ) } }
		);
	}

	function nextMonths() {
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Next months' } )
		);
	}

	function previousMonths() {
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Previous months' } )
		);
	}

	it( 'going from 9 to 10 weekly dates updates the summary without adding a third month', async () => {
		await renderModal( septemberProps );

		setOccurrenceCount( 9 );
		expect( screen.getByText( /9 dates, until/ ) ).toBeInTheDocument();
		expect( monthLabels() ).toEqual( [ 'September 2026', 'October 2026' ] );
		// Both months hold every date, so there is nowhere further to go.
		expect(
			screen.getByRole( 'button', { name: 'Next months' } )
		).toBeDisabled();

		setOccurrenceCount( 10 );
		expect( screen.getByText( /10 dates, until/ ) ).toBeInTheDocument();
		expect( monthLabels() ).toEqual( [ 'September 2026', 'October 2026' ] );
		expect(
			screen.getByRole( 'button', { name: /Create series — 10 dates/ } )
		).toBeInTheDocument();

		// The tenth date (Nov 3) is one page away.
		expect(
			screen.getByRole( 'button', { name: 'Previous months' } )
		).toBeDisabled();
		nextMonths();
		expect( monthLabels() ).toEqual( [ 'November 2026', 'December 2026' ] );
		expect(
			screen.getByRole( 'button', { name: 'Next months' } )
		).toBeDisabled();
	} );

	it( 'keeps the viewed months when the schedule changes, even when it shrinks behind them', async () => {
		await renderModal( septemberProps );

		nextMonths();
		setOccurrenceCount( 12 );
		expect( screen.getByText( /12 dates, until/ ) ).toBeInTheDocument();
		expect( monthLabels() ).toEqual( [ 'November 2026', 'December 2026' ] );

		setOccurrenceCount( 2 );
		expect( screen.getByText( /2 dates, until/ ) ).toBeInTheDocument();
		expect( monthLabels() ).toEqual( [ 'November 2026', 'December 2026' ] );

		previousMonths();
		expect( monthLabels() ).toEqual( [ 'September 2026', 'October 2026' ] );
	} );

	it( 'shows two months for a series that fits in one', async () => {
		await renderModal( septemberProps );

		setOccurrenceCount( 2 );
		expect( monthLabels() ).toEqual( [ 'September 2026', 'October 2026' ] );
	} );

	it( 'selects dates across pages in the Irregular tab without moving the view', async () => {
		await renderModal( septemberProps );
		openIrregularTab();

		expect( monthLabels() ).toEqual( [ 'September 2026', 'October 2026' ] );
		expect(
			screen.getByRole( 'button', { name: 'Previous months' } )
		).toBeDisabled();

		fireEvent.click(
			screen.getByRole( 'button', {
				name: fullDateLabel( '2026-10-10' ),
			} )
		);
		nextMonths();
		fireEvent.click(
			screen.getByRole( 'button', {
				name: fullDateLabel( '2026-12-05' ),
			} )
		);

		// Selecting a date leaves the page where it is.
		expect( monthLabels() ).toEqual( [ 'November 2026', 'December 2026' ] );
		expect( screen.getByText( '3 dates selected' ) ).toBeInTheDocument();

		// Paging keeps the selection, and removing the latest date does not
		// pull the view back.
		previousMonths();
		expect(
			screen.getByRole( 'button', {
				name: fullDateLabel( '2026-10-10' ),
			} )
		).toHaveAttribute( 'aria-pressed', 'true' );
		nextMonths();
		fireEvent.click(
			screen.getByRole( 'button', {
				name: fullDateLabel( '2026-12-05' ),
			} )
		);
		expect( screen.getByText( '2 dates selected' ) ).toBeInTheDocument();
		expect( monthLabels() ).toEqual( [ 'November 2026', 'December 2026' ] );
		// The picker can always move further ahead.
		expect(
			screen.getByRole( 'button', { name: 'Next months' } )
		).not.toBeDisabled();
	} );

	it( 'remembers a separate viewed month for each tab', async () => {
		await renderModal( septemberProps );

		nextMonths();
		expect( monthLabels() ).toEqual( [ 'November 2026', 'December 2026' ] );

		openIrregularTab();
		expect( monthLabels() ).toEqual( [ 'September 2026', 'October 2026' ] );
		nextMonths();
		nextMonths();
		expect( monthLabels() ).toEqual( [ 'January 2027', 'February 2027' ] );

		fireEvent.click(
			screen.getByRole( 'tab', { name: 'Regular schedule' } )
		);
		expect( monthLabels() ).toEqual( [ 'November 2026', 'December 2026' ] );

		openIrregularTab();
		expect( monthLabels() ).toEqual( [ 'January 2027', 'February 2027' ] );
	} );

	it( 'paging does not change what the Regular tab saves', async () => {
		apiFetch.mockResolvedValue( { generated_occurrences: [] } );
		const onSaved = jest.fn();
		await renderModal( { ...septemberProps, onSaved } );

		nextMonths();
		previousMonths();
		nextMonths();
		fireEvent.click(
			screen.getByRole( 'button', { name: /Create series — 10 dates/ } )
		);
		await waitFor( () => expect( onSaved ).toHaveBeenCalled() );

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-events/v1/event-dates/9',
				method: 'PUT',
				data: { rrule: 'FREQ=WEEKLY;COUNT=10' },
			} )
		);
	} );

	it( 'paging does not change what the Irregular tab saves', async () => {
		apiFetch.mockResolvedValue( {
			recurrence_mode: 'manual',
			generated_occurrences: [],
		} );
		const onSaved = jest.fn();
		await renderModal( { ...septemberProps, onSaved } );
		openIrregularTab();

		fireEvent.click(
			screen.getByRole( 'button', {
				name: fullDateLabel( '2026-09-15' ),
			} )
		);
		nextMonths();
		nextMonths();
		previousMonths();
		fireEvent.click(
			screen.getByRole( 'button', { name: /Create series — 2 dates/ } )
		);
		await waitFor( () => expect( onSaved ).toHaveBeenCalled() );

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-events/v1/event-dates/9',
				method: 'PUT',
				data: {
					recurrence_mode: 'manual',
					manual_dates: [ '2026-09-01', '2026-09-15' ],
				},
			} )
		);
	} );

	it( 'keeps the calendar next to the message when no dates match', async () => {
		await renderModal( {
			...septemberProps,
			// Ends before it starts: the schedule produces nothing.
			initialRrule: 'FREQ=WEEKLY;UNTIL=20260801',
		} );

		expect(
			screen.getByText( 'No dates match this schedule yet.' )
		).toBeInTheDocument();
		expect( monthLabels() ).toEqual( [ 'September 2026', 'October 2026' ] );
	} );
} );
