/**
 * @jest-environment jsdom
 *
 * Tests for DayCell's mobile agenda support (#1168): the localized
 * data-month-name attribute and rendering all events (clamped to 3 rows
 * by CSS in grid mode only, not by JS slicing).
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import DayCell from '../DayCell.js';

function makeEvents(count) {
	return Array.from({ length: count }, (_, index) => ({
		uid: `standalone_${index}@example.com`,
		title: `Event ${index + 1}`,
	}));
}

it('adds a localized data-month-name attribute to the day number', () => {
	const { container } = render(
		<DayCell
			date={new Date(2026, 6, 15)}
			events={[]}
			isCurrentMonth
			isToday={false}
			isPast={false}
			onAddEvent={() => {}}
		/>
	);

	const dayNumber = container.querySelector(
		'.fair-events-calendar-day-number'
	);
	expect(dayNumber).toHaveAttribute(
		'data-month-name',
		new Date(2026, 6, 15).toLocaleDateString(undefined, { month: 'long' })
	);
});

it('renders every event row in the DOM, not just the first three', () => {
	render(
		<DayCell
			date={new Date(2026, 6, 15)}
			events={makeEvents(5)}
			isCurrentMonth
			isToday={false}
			isPast={false}
			onAddEvent={() => {}}
		/>
	);

	for (let i = 1; i <= 5; i++) {
		expect(screen.getByText(`Event ${i}`)).toBeInTheDocument();
	}
});

it('shows a "+N more" label counting events beyond the first three', () => {
	render(
		<DayCell
			date={new Date(2026, 6, 15)}
			events={makeEvents(5)}
			isCurrentMonth
			isToday={false}
			isPast={false}
			onAddEvent={() => {}}
		/>
	);

	expect(screen.getByText('+2 more')).toBeInTheDocument();
});

it('omits the "+N more" label when there are three events or fewer', () => {
	render(
		<DayCell
			date={new Date(2026, 6, 15)}
			events={makeEvents(3)}
			isCurrentMonth
			isToday={false}
			isPast={false}
			onAddEvent={() => {}}
		/>
	);

	expect(screen.queryByText(/more$/)).not.toBeInTheDocument();
});
