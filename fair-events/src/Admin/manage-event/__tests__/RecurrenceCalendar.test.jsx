/**
 * @jest-environment jsdom
 *
 * Tests for RecurrenceCalendar (#981 Part 3).
 *
 * Covers:
 *   - Active and cancelled cells render as links with the correct
 *     `event_date_id` href and a full-date aria-label.
 *   - The master cell links to itself.
 *   - The grid no longer toggles on click (no onToggleExdate/togglingExdate
 *     props exist any more).
 */
import '@testing-library/jest-dom';
import { render, screen } from '@testing-library/react';
import RecurrenceCalendar from '../RecurrenceCalendar.js';

const generatedOccurrences = [
	{ id: 2, start_datetime: '2026-07-08 18:00:00', status: 'active' },
	{ id: 3, start_datetime: '2026-07-15 18:00:00', status: 'cancelled' },
];

// Matches the aria-label built in RecurrenceCalendar's MiniMonth.
function fullDateLabel(dateStr) {
	return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

it('renders active occurrences as navigable links with a full-date aria-label', () => {
	render(
		<RecurrenceCalendar
			generatedOccurrences={generatedOccurrences}
			cancelledDates={['2026-07-15']}
			masterDate="2026-07-01"
			manageEventUrl="http://example.com/manage"
			masterEventDateId={1}
			embedded
		/>
	);

	const activeLink = screen.getByRole('link', {
		name: fullDateLabel('2026-07-08'),
	});
	expect(activeLink).toHaveAttribute(
		'href',
		'http://example.com/manage&event_date_id=2'
	);
});

it('renders cancelled occurrences as navigable links to their own event_date_id', () => {
	render(
		<RecurrenceCalendar
			generatedOccurrences={generatedOccurrences}
			cancelledDates={['2026-07-15']}
			masterDate="2026-07-01"
			manageEventUrl="http://example.com/manage"
			masterEventDateId={1}
			embedded
		/>
	);

	const cancelledLink = screen.getByRole('link', {
		name: fullDateLabel('2026-07-15'),
	});
	expect(cancelledLink).toHaveAttribute(
		'href',
		'http://example.com/manage&event_date_id=3'
	);
});

it('links the master cell to the master event_date_id', () => {
	render(
		<RecurrenceCalendar
			generatedOccurrences={generatedOccurrences}
			cancelledDates={['2026-07-15']}
			masterDate="2026-07-01"
			manageEventUrl="http://example.com/manage"
			masterEventDateId={1}
			embedded
		/>
	);

	const masterLink = screen.getByRole('link', {
		name: fullDateLabel('2026-07-01'),
	});
	expect(masterLink).toHaveAttribute(
		'href',
		'http://example.com/manage&event_date_id=1'
	);
});
