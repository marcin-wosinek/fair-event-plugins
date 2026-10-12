/**
 * @jest-environment jsdom
 *
 * Tests for SalePeriodsCalendar (#1197).
 *
 * Covers:
 *   - Hidden while any boundary is unresolved; shown once every boundary
 *     (sale_start/sale_end chain) is set, in both single- and
 *     multi-period shapes.
 *   - Legend lists every period (name or "Period N") plus the event day.
 *   - Display-only: day cells render as plain cells, not buttons.
 *   - Dates with no ticket on sale (#1840): named in a warning, hatched on
 *     the grid, and explained in the legend.
 */
import '@testing-library/jest-dom';
import { render, screen, within } from '@testing-library/react';
import SalePeriodsCalendar, {
	salePeriodIndexForDate,
} from '../SalePeriodsCalendar.js';

const twoNamedPeriods = [
	{
		id: 1,
		name: 'Early bird',
		sale_start: '2026-08-01',
		sale_end: '2026-08-15',
	},
	{
		id: 2,
		name: 'Regular',
		sale_start: '2026-08-15',
		sale_end: '2026-09-01',
	},
];

it( 'renders nothing when a boundary is unresolved (freshly seeded default)', () => {
	const { container } = render(
		<SalePeriodsCalendar
			salePeriods={ [ { name: '', sale_start: '', sale_end: '' } ] }
			eventDay="2026-09-05"
			embedded
		/>
	);
	expect( container ).toBeEmptyDOMElement();
} );

it( 'renders nothing when there are no sale periods', () => {
	const { container } = render(
		<SalePeriodsCalendar
			salePeriods={ [] }
			eventDay="2026-09-05"
			embedded
		/>
	);
	expect( container ).toBeEmptyDOMElement();
} );

it( 'renders in single-period mode once both boundaries are set', () => {
	render(
		<SalePeriodsCalendar
			salePeriods={ [
				{ name: '', sale_start: '2026-08-01', sale_end: '2026-09-01' },
			] }
			eventDay="2026-08-20"
			embedded
		/>
	);
	expect( screen.getByText( 'Period 1' ) ).toBeInTheDocument();
	expect( screen.getByText( 'Event day' ) ).toBeInTheDocument();
} );

it( 'lists every period by name (or "Period N" when unnamed) plus the event day in the legend', () => {
	render(
		<SalePeriodsCalendar
			salePeriods={ twoNamedPeriods }
			eventDay="2026-08-20"
			embedded
		/>
	);
	expect( screen.getByText( 'Early bird' ) ).toBeInTheDocument();
	expect( screen.getByText( 'Regular' ) ).toBeInTheDocument();
	expect( screen.getByText( 'Event day' ) ).toBeInTheDocument();
} );

it( 'renders day cells as plain, non-operable cells rather than buttons', () => {
	render(
		<SalePeriodsCalendar
			salePeriods={ twoNamedPeriods }
			eventDay="2026-08-20"
			embedded
		/>
	);
	expect( screen.queryByRole( 'button' ) ).not.toBeInTheDocument();
} );

it( 'marks a period with an automatically-resolved outer boundary in the legend (#1582)', () => {
	render(
		<SalePeriodsCalendar
			salePeriods={ [
				{
					id: 1,
					name: 'Open start',
					sale_start: '2026-08-01',
					sale_end: '2026-08-15',
					isAutomaticStart: true,
				},
				{
					id: 2,
					name: 'Regular',
					sale_start: '2026-08-15',
					sale_end: '2026-09-01',
				},
			] }
			eventDay="2026-08-20"
			embedded
		/>
	);
	expect( screen.getByText( 'Open start (automatic)' ) ).toBeInTheDocument();
	expect( screen.getByText( 'Regular' ) ).toBeInTheDocument();
} );

it( 'assigns every adjacent boundary date to exactly one period', () => {
	expect( salePeriodIndexForDate( twoNamedPeriods, '2026-08-14' ) ).toBe( 0 );
	expect( salePeriodIndexForDate( twoNamedPeriods, '2026-08-15' ) ).toBe( 1 );
	expect( salePeriodIndexForDate( twoNamedPeriods, '2026-08-31' ) ).toBe( 1 );
	expect( salePeriodIndexForDate( twoNamedPeriods, '2026-09-01' ) ).toBe(
		-1
	);
} );

describe( 'dates with no tickets on sale (#1840)', () => {
	// The day cell for `day` in the month headed `monthLabel`.
	const dayCell = ( monthLabel, day ) =>
		within( screen.getByText( monthLabel ).parentElement ).getByText(
			String( day ),
			{ exact: true }
		);
	// jsdom drops the striped gradient background, so the struck-through
	// day number stands in for the whole "no tickets" treatment.
	const isMarkedUnavailable = ( cell ) =>
		cell.style.textDecoration === 'line-through';

	it( 'shows no warning or legend entry without unavailable dates', () => {
		render(
			<SalePeriodsCalendar
				salePeriods={ twoNamedPeriods }
				eventDay="2026-08-20"
				unavailableDates={ [] }
				embedded
			/>
		);
		expect(
			screen.queryByText( /no tickets on sale/i )
		).not.toBeInTheDocument();
		expect( isMarkedUnavailable( dayCell( 'August 2026', 20 ) ) ).toBe(
			false
		);
	} );

	it( 'names each affected period with its date range in a warning', () => {
		render(
			<SalePeriodsCalendar
				salePeriods={ [
					...twoNamedPeriods,
					{
						id: 3,
						name: '',
						sale_start: '2026-09-01',
						sale_end: '2026-09-02',
					},
				] }
				eventDay="2026-09-01"
				unavailableDates={ [
					{ periodIndex: 1, start: '2026-08-28', end: '2026-08-31' },
					{ periodIndex: 2, start: '2026-09-01', end: '2026-09-01' },
				] }
				embedded
			/>
		);

		expect(
			screen.getByText(
				'Some sale periods have dates with no tickets on sale.'
			)
		).toBeInTheDocument();
		expect(
			screen.getByText(
				/^Regular: no tickets on sale from .*28.* to .*31.*\.$/
			)
		).toBeInTheDocument();
		// An unnamed period is called "Period N"; a single day has no range.
		expect(
			screen.getByText( /^Period 3: no tickets on sale on .*2026.*\.$/ )
		).toBeInTheDocument();
		expect( screen.getByText( 'No tickets on sale' ) ).toBeInTheDocument();
	} );

	it( 'hatches only the affected dates and keeps the others plain', () => {
		render(
			<SalePeriodsCalendar
				salePeriods={ twoNamedPeriods }
				eventDay="2026-08-20"
				unavailableDates={ [
					{ periodIndex: 0, start: '2026-08-10', end: '2026-08-14' },
				] }
				embedded
			/>
		);

		expect( isMarkedUnavailable( dayCell( 'August 2026', 9 ) ) ).toBe(
			false
		);
		expect( isMarkedUnavailable( dayCell( 'August 2026', 10 ) ) ).toBe(
			true
		);
		expect( isMarkedUnavailable( dayCell( 'August 2026', 14 ) ) ).toBe(
			true
		);
		// The next period starts on the 15th and is unaffected.
		expect( isMarkedUnavailable( dayCell( 'August 2026', 15 ) ) ).toBe(
			false
		);
	} );

	it( 'keeps the event-day border on a hatched date', () => {
		render(
			<SalePeriodsCalendar
				salePeriods={ twoNamedPeriods }
				eventDay="2026-08-20"
				unavailableDates={ [
					{ periodIndex: 1, start: '2026-08-15', end: '2026-08-31' },
				] }
				embedded
			/>
		);

		const eventDayCell = dayCell( 'August 2026', 20 );
		expect( isMarkedUnavailable( eventDayCell ) ).toBe( true );
		expect( eventDayCell.style.border ).toContain( '3px solid' );
	} );

	it( 'names a range that lies outside the displayed month', () => {
		render(
			<SalePeriodsCalendar
				salePeriods={ [
					{
						id: 1,
						name: 'Long sale',
						sale_start: '2026-01-01',
						sale_end: '2026-12-01',
					},
				] }
				eventDay="2026-11-30"
				unavailableDates={ [
					{ periodIndex: 0, start: '2026-11-10', end: '2026-11-30' },
				] }
				embedded
			/>
		);

		expect( screen.queryByText( 'November 2026' ) ).not.toBeInTheDocument();
		expect(
			screen.getByText(
				/^Long sale: no tickets on sale from .*November.* to .*November.*\.$/
			)
		).toBeInTheDocument();
	} );
} );
