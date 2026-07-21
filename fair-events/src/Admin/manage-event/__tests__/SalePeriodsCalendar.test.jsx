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
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import SalePeriodsCalendar from '../SalePeriodsCalendar.js';

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
			embedded
		/>
	);
	expect(container).toBeEmptyDOMElement();
});

it('renders nothing when there are no sale periods', () => {
	const { container } = render(
		<SalePeriodsCalendar salePeriods={[]} eventDay="2026-09-05" embedded />
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
			embedded
		/>
	);
	expect(screen.getByText('Early bird')).toBeInTheDocument();
	expect(screen.getByText('Regular')).toBeInTheDocument();
	expect(screen.getByText('Event day')).toBeInTheDocument();
});

it('renders day cells as plain, non-operable cells rather than buttons', () => {
	render(
		<SalePeriodsCalendar
			salePeriods={twoNamedPeriods}
			eventDay="2026-08-20"
			embedded
		/>
	);
	expect(screen.queryByRole('button')).not.toBeInTheDocument();
});
