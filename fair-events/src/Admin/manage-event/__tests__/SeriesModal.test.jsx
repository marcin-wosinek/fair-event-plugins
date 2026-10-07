/**
 * @jest-environment jsdom
 *
 * Tests for SeriesModal's "Regular schedule" and "Irregular series" tabs
 * (#979, #1127, #1749).
 *
 * Covers:
 *   - Regular tab: the calendar highlights every rule-generated date and a
 *     compact "N dates, until <date>" summary line replaces the old text
 *     list.
 *   - Regular tab (#1749): generated dates toggle between included and
 *     skipped, the original date and off-schedule days cannot be toggled, the
 *     count of dates drops without extending the schedule, and confirm sends
 *     the rule together with the complete list of skipped dates.
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

it( 'Regular tab shows the generated dates and a compact dates summary', async () => {
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

	// Only the generated dates visible in the two months are buttons, all
	// included to start with; every other day is plain text.
	expect( screen.getAllByRole( 'button', { pressed: true } ) ).toHaveLength(
		9
	);
	expect(
		screen.queryAllByRole( 'button', { pressed: false } )
	).toHaveLength( 0 );
	expect( screen.queryByText( /skipped$/ ) ).not.toBeInTheDocument();
} );

describe( 'skipping dates of a regular schedule', () => {
	// Weekly from Wed 1 July 2026, 10 dates: the last one is 2 September.
	const julyProps = {
		eventDateId: 4,
		initialRrule: null,
		initialRecurrenceMode: null,
		startDatetime: '2026-07-01 18:00:00',
		generatedOccurrences: [],
		onClose: () => {},
		onSaved: () => {},
		onImpact: () => {},
	};

	function dayButton( dateStr ) {
		return screen.getByRole( 'button', {
			name: new RegExp( `^${ fullDateLabel( dateStr ) } — ` ),
		} );
	}

	function setOccurrenceCount( count ) {
		fireEvent.change(
			screen.getByRole( 'spinbutton', {
				name: 'Number of occurrences',
			} ),
			{ target: { value: String( count ) } }
		);
	}

	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'skips a generated date on click and restores it on the next click', async () => {
		await renderModal( julyProps );

		const day = dayButton( '2026-07-15' );
		expect( day ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( day ).toHaveAccessibleName( /included, activate to skip$/ );

		fireEvent.click( day );
		expect( day ).toHaveAttribute( 'aria-pressed', 'false' );
		expect( day ).toHaveAccessibleName( /skipped, activate to restore$/ );
		expect( day ).toHaveStyle( { textDecoration: 'line-through' } );
		// One date fewer, and the schedule still ends where it did.
		expect( screen.getByText( /^9 dates, until/ ) ).toBeInTheDocument();
		expect( screen.getByText( '1 date skipped' ) ).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Create series — 9 dates' } )
		).toBeInTheDocument();

		fireEvent.click( day );
		expect( day ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( day ).toHaveStyle( { textDecoration: 'none' } );
		expect( screen.getByText( /^10 dates, until/ ) ).toBeInTheDocument();
		expect( screen.queryByText( /skipped$/ ) ).not.toBeInTheDocument();
	} );

	it( 'does not extend the schedule to make up for skipped dates', async () => {
		await renderModal( julyProps );

		fireEvent.click( dayButton( '2026-07-08' ) );
		fireEvent.click( dayButton( '2026-07-22' ) );
		expect( screen.getByText( '2 dates skipped' ) ).toBeInTheDocument();
		expect( screen.getByText( /^8 dates, until/ ) ).toBeInTheDocument();

		// The tenth weekly date is still the last one: nothing on 9 September.
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Next months' } )
		);
		expect( dayButton( '2026-09-02' ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect(
			screen.queryByRole( 'button', {
				name: new RegExp( fullDateLabel( '2026-09-09' ) ),
			} )
		).not.toBeInTheDocument();
	} );

	it( 'keeps the original date and off-schedule days out of reach', async () => {
		await renderModal( julyProps );

		const original = dayButton( '2026-07-01' );
		expect( original ).toBeDisabled();
		expect( original ).toHaveAttribute( 'aria-pressed', 'true' );
		expect( original ).toHaveAccessibleName(
			/original date, always included$/
		);
		fireEvent.click( original );
		expect( screen.getByText( /^10 dates, until/ ) ).toBeInTheDocument();
		// The reason is on the page, not only in a tooltip.
		expect(
			screen.getByText( /The original date \(blue\) is always part/ )
		).toBeInTheDocument();

		// A day the schedule does not generate is plain text: nothing to click.
		expect(
			screen.queryByRole( 'button', {
				name: new RegExp( fullDateLabel( '2026-07-02' ) ),
			} )
		).not.toBeInTheDocument();
		fireEvent.click( screen.getAllByText( '2', { exact: true } )[ 0 ] );
		expect( screen.getByText( /^10 dates, until/ ) ).toBeInTheDocument();
	} );

	it( 'offers each generated date as a focusable native toggle button', async () => {
		await renderModal( julyProps );

		const day = dayButton( '2026-07-15' );
		// A native <button>: Enter and Space activate it without extra code.
		expect( day.tagName ).toBe( 'BUTTON' );
		expect( day ).toHaveAttribute( 'type', 'button' );
		day.focus();
		expect( day ).toHaveFocus();
	} );

	it( 'sends the rule and the complete list of skipped dates in one request', async () => {
		apiFetch.mockResolvedValue( { generated_occurrences: [] } );
		const onSaved = jest.fn();
		await renderModal( { ...julyProps, onSaved } );

		fireEvent.click( dayButton( '2026-07-22' ) );
		fireEvent.click( dayButton( '2026-07-08' ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create series — 8 dates' } )
		);
		await waitFor( () => expect( onSaved ).toHaveBeenCalled() );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: '/fair-events/v1/event-dates/4',
				method: 'PUT',
				data: {
					rrule: 'FREQ=WEEKLY;COUNT=10',
					excluded_dates: [ '2026-07-08', '2026-07-22' ],
				},
			} )
		);
	} );

	it( 'keeps a skip by exact date while the schedule changes, saving only those still in it', async () => {
		apiFetch.mockResolvedValue( { generated_occurrences: [] } );
		const onSaved = jest.fn();
		await renderModal( { ...julyProps, onSaved } );

		fireEvent.click( dayButton( '2026-07-08' ) );
		fireEvent.click( dayButton( '2026-08-19' ) );
		expect( screen.getByText( '2 dates skipped' ) ).toBeInTheDocument();

		// Four dates end on 22 July: 19 August is no longer in the schedule.
		setOccurrenceCount( 4 );
		expect( screen.getByText( /^3 dates, until/ ) ).toBeInTheDocument();
		expect( screen.getByText( '1 date skipped' ) ).toBeInTheDocument();

		// It comes back still skipped.
		setOccurrenceCount( 10 );
		expect( dayButton( '2026-08-19' ) ).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		expect( screen.getByText( '2 dates skipped' ) ).toBeInTheDocument();

		setOccurrenceCount( 4 );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create series — 3 dates' } )
		);
		await waitFor( () => expect( onSaved ).toHaveBeenCalled() );
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				data: {
					rrule: 'FREQ=WEEKLY;COUNT=4',
					excluded_dates: [ '2026-07-08' ],
				},
			} )
		);
	} );

	it( 'reopens an existing series with its cancelled dates skipped and lets them be restored', async () => {
		apiFetch.mockResolvedValue( { generated_occurrences: [] } );
		const onSaved = jest.fn();
		await renderModal( {
			...julyProps,
			initialRrule: 'FREQ=WEEKLY;COUNT=4',
			initialRecurrenceMode: 'rule',
			// 5 August was dropped by an earlier, longer schedule: not a skip.
			cancelledDates: [ '2026-07-15', '2026-08-05' ],
			onSaved,
		} );

		expect( dayButton( '2026-07-15' ) ).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		expect( screen.getByText( /^3 dates, until/ ) ).toBeInTheDocument();
		expect( screen.getByText( '1 date skipped' ) ).toBeInTheDocument();

		// Growing the schedule back brings 5 August in as a normal date.
		setOccurrenceCount( 6 );
		expect( dayButton( '2026-08-05' ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		fireEvent.click( dayButton( '2026-07-15' ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Update series — 6 dates' } )
		);
		await waitFor( () => expect( onSaved ).toHaveBeenCalled() );
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				data: { rrule: 'FREQ=WEEKLY;COUNT=6', excluded_dates: [] },
			} )
		);
	} );

	it( 'discards unsaved toggles when the modal is closed and reopened', async () => {
		const props = {
			...julyProps,
			initialRrule: 'FREQ=WEEKLY;COUNT=4',
			initialRecurrenceMode: 'rule',
			cancelledDates: [ '2026-07-15' ],
		};
		const { unmount } = await renderModal( props );

		fireEvent.click( dayButton( '2026-07-08' ) );
		fireEvent.click( dayButton( '2026-07-15' ) );
		expect( screen.getByText( /^3 dates, until/ ) ).toBeInTheDocument();
		unmount();
		expect( apiFetch ).not.toHaveBeenCalled();

		await renderModal( props );
		expect( dayButton( '2026-07-08' ) ).toHaveAttribute(
			'aria-pressed',
			'true'
		);
		expect( dayButton( '2026-07-15' ) ).toHaveAttribute(
			'aria-pressed',
			'false'
		);
	} );

	it( 'keeps the skips across a visit to the Irregular tab, which saves none of them', async () => {
		apiFetch.mockResolvedValue( {
			recurrence_mode: 'manual',
			generated_occurrences: [],
		} );
		const onSaved = jest.fn();
		await renderModal( { ...julyProps, onSaved } );

		fireEvent.click( dayButton( '2026-07-15' ) );
		openIrregularTab();
		// The irregular picker is unaffected: only the original date is selected.
		expect( screen.getByText( '1 dates selected' ) ).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'tab', { name: 'Regular schedule' } )
		);
		expect( dayButton( '2026-07-15' ) ).toHaveAttribute(
			'aria-pressed',
			'false'
		);

		openIrregularTab();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create series — 1 date' } )
		);
		await waitFor( () => expect( onSaved ).toHaveBeenCalled() );
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				data: {
					recurrence_mode: 'manual',
					manual_dates: [ '2026-07-01' ],
				},
			} )
		);
	} );

	it( 'shows the error and keeps the skips when saving fails', async () => {
		apiFetch.mockRejectedValue( {
			message: '2026-07-15 is not part of this schedule.',
		} );
		const onSaved = jest.fn();
		const onImpact = jest.fn();
		await renderModal( { ...julyProps, onSaved, onImpact } );

		fireEvent.click( dayButton( '2026-07-15' ) );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create series — 9 dates' } )
		);

		expect(
			await screen.findByText(
				'2026-07-15 is not part of this schedule.'
			)
		).toBeInTheDocument();
		expect( onSaved ).not.toHaveBeenCalled();
		expect( onImpact ).toHaveBeenCalledWith( null );
		expect( dayButton( '2026-07-15' ) ).toHaveAttribute(
			'aria-pressed',
			'false'
		);
		expect(
			screen.getByRole( 'button', { name: 'Create series — 9 dates' } )
		).not.toBeDisabled();
	} );
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
				data: { rrule: 'FREQ=WEEKLY;COUNT=10', excluded_dates: [] },
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
