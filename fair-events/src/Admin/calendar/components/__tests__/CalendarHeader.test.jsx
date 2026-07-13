/**
 * @jest-environment jsdom
 *
 * Tests for CalendarHeader's "Add event" button (#1052).
 */
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import CalendarHeader from '../CalendarHeader.js';

const currentDate = new Date(2026, 6, 1);

it('renders Previous, Today, Next, and Add event buttons', () => {
	render(
		<CalendarHeader
			currentDate={currentDate}
			onPrevMonth={() => {}}
			onNextMonth={() => {}}
			onToday={() => {}}
			onAddEvent={() => {}}
		/>
	);
	expect(
		screen.getByRole('button', { name: 'Previous' })
	).toBeInTheDocument();
	expect(screen.getByRole('button', { name: 'Today' })).toBeInTheDocument();
	expect(screen.getByRole('button', { name: 'Next' })).toBeInTheDocument();
	expect(
		screen.getByRole('button', { name: 'Add event' })
	).toBeInTheDocument();
});

it('calls onAddEvent when the Add event button is clicked', () => {
	const onAddEvent = jest.fn();
	render(
		<CalendarHeader
			currentDate={currentDate}
			onPrevMonth={() => {}}
			onNextMonth={() => {}}
			onToday={() => {}}
			onAddEvent={onAddEvent}
		/>
	);
	fireEvent.click(screen.getByRole('button', { name: 'Add event' }));
	expect(onAddEvent).toHaveBeenCalledTimes(1);
});
