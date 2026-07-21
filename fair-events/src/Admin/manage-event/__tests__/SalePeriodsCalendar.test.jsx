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
 *   - Clicking a day calls onMoveBoundary with the *nearest* boundary
 *     index and the clicked date — a click near a middle boundary picks
 *     that boundary, not sale start.
 *   - The accessible name / tooltip names the exact boundary and target
 *     date that a click would move.
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import SalePeriodsCalendar from '../SalePeriodsCalendar.js';

// Matches the message built in SalePeriodsCalendar's dayProps().
function moveMessage(boundaryLabel, dateStr) {
	const formatted = new Date(`${dateStr}T00:00:00`).toLocaleDateString(
		undefined,
		{ weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }
	);
	return `Move the ${boundaryLabel} to ${formatted}`;
}

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

it('renders nothing when a boundary is unresolved (freshly seeded default)', () => {
	const { container } = render(
		<SalePeriodsCalendar
			salePeriods={[{ name: '', sale_start: '', sale_end: '' }]}
			eventDay="2026-09-05"
			onMoveBoundary={() => {}}
			embedded
		/>
	);
	expect(container).toBeEmptyDOMElement();
});

it('renders nothing when there are no sale periods', () => {
	const { container } = render(
		<SalePeriodsCalendar
			salePeriods={[]}
			eventDay="2026-09-05"
			onMoveBoundary={() => {}}
			embedded
		/>
	);
	expect(container).toBeEmptyDOMElement();
});

it('renders in single-period mode once both boundaries are set', () => {
	render(
		<SalePeriodsCalendar
			salePeriods={[
				{ name: '', sale_start: '2026-08-01', sale_end: '2026-09-01' },
			]}
			eventDay="2026-08-20"
			onMoveBoundary={() => {}}
			embedded
		/>
	);
	expect(screen.getByText('Period 1')).toBeInTheDocument();
	expect(screen.getByText('Event day')).toBeInTheDocument();
});

it('lists every period by name (or "Period N" when unnamed) plus the event day in the legend', () => {
	render(
		<SalePeriodsCalendar
			salePeriods={twoNamedPeriods}
			eventDay="2026-08-20"
			onMoveBoundary={() => {}}
			embedded
		/>
	);
	expect(screen.getByText('Early bird')).toBeInTheDocument();
	expect(screen.getByText('Regular')).toBeInTheDocument();
	expect(screen.getByText('Event day')).toBeInTheDocument();
});

it('clicking a day near the middle boundary moves that boundary, not sale start', () => {
	const onMoveBoundary = jest.fn();
	render(
		<SalePeriodsCalendar
			salePeriods={twoNamedPeriods}
			eventDay="2026-08-20"
			onMoveBoundary={onMoveBoundary}
			embedded
		/>
	);

	// One day after the shared Early-bird/Regular boundary (2026-08-15) —
	// closer to it than to either the sale-start (08-01) or sale-end
	// (09-01) boundary.
	const button = screen.getByRole('button', {
		name: moveMessage("start of 'Regular'", '2026-08-16'),
	});
	fireEvent.click(button);

	expect(onMoveBoundary).toHaveBeenCalledWith(1, '2026-08-16');
});

it('clicking the first day of the calendar moves the sale-start boundary', () => {
	const onMoveBoundary = jest.fn();
	render(
		<SalePeriodsCalendar
			salePeriods={twoNamedPeriods}
			eventDay="2026-08-20"
			onMoveBoundary={onMoveBoundary}
			embedded
		/>
	);

	const button = screen.getByRole('button', {
		name: moveMessage("start of 'Early bird'", '2026-08-01'),
	});
	fireEvent.click(button);

	expect(onMoveBoundary).toHaveBeenCalledWith(0, '2026-08-01');
});

it('clicking the last day of the calendar moves the sale-end boundary', () => {
	const onMoveBoundary = jest.fn();
	render(
		<SalePeriodsCalendar
			salePeriods={twoNamedPeriods}
			eventDay="2026-08-20"
			onMoveBoundary={onMoveBoundary}
			embedded
		/>
	);

	const button = screen.getByRole('button', {
		name: moveMessage("end of 'Regular'", '2026-09-01'),
	});
	fireEvent.click(button);

	expect(onMoveBoundary).toHaveBeenCalledWith(2, '2026-09-01');
});

it('describes an unnamed boundary as "period N" rather than start/end wording', () => {
	const onMoveBoundary = jest.fn();
	const unnamedPeriods = [
		{ id: 1, name: '', sale_start: '2026-08-01', sale_end: '2026-08-15' },
		{ id: 2, name: '', sale_start: '2026-08-15', sale_end: '2026-09-01' },
	];
	render(
		<SalePeriodsCalendar
			salePeriods={unnamedPeriods}
			eventDay="2026-08-20"
			onMoveBoundary={onMoveBoundary}
			embedded
		/>
	);

	const button = screen.getByRole('button', {
		name: moveMessage('period 1', '2026-08-01'),
	});
	fireEvent.click(button);

	expect(onMoveBoundary).toHaveBeenCalledWith(0, '2026-08-01');
});
