/**
 * Calendar Grid Component
 *
 * Generates 7-column CSS grid calendar with day cells.
 *
 * @package FairEvents
 */

import DayCell from './DayCell.js';
import {
	formatLocalDate,
	getWeekdayLabels,
	calculateLeadingDays,
	groupEventsByDate,
} from 'fair-events-shared';

export default function CalendarGrid( {
	currentDate,
	events,
	onAddEvent,
	onEditEvent,
} ) {
	// Get start_of_week setting (0 = Sunday, 1 = Monday)
	const startOfWeek = window.fairEventsCalendarData?.startOfWeek ?? 1;

	const year = currentDate.getFullYear();
	const month = currentDate.getMonth();

	const firstDayOfMonth = new Date( year, month, 1 );
	const lastDayOfMonth = new Date( year, month + 1, 0 );
	const daysInMonth = lastDayOfMonth.getDate();

	// Calculate first weekday (adjusted for start_of_week)
	// This gives us how many leading days we need from the previous month
	const firstWeekday = calculateLeadingDays( firstDayOfMonth, startOfWeek );

	// Calculate total cells needed
	const totalCells = firstWeekday + daysInMonth;
	const trailingDays = totalCells % 7 === 0 ? 0 : 7 - ( totalCells % 7 );

	// Generate weekday labels
	const weekdayLabels = getWeekdayLabels( startOfWeek );

	// Group events by date (using local time, not UTC)
	const eventsByDate = groupEventsByDate( events );

	// Build calendar days array
	const days = [];

	// Leading days from previous month
	for ( let i = firstWeekday - 1; i >= 0; i-- ) {
		const date = new Date( year, month, -i );
		days.push( {
			date,
			isCurrentMonth: false,
			events: eventsByDate[ formatLocalDate( date ) ] || [],
		} );
	}

	// Days in current month
	for ( let day = 1; day <= daysInMonth; day++ ) {
		const date = new Date( year, month, day );
		days.push( {
			date,
			isCurrentMonth: true,
			events: eventsByDate[ formatLocalDate( date ) ] || [],
		} );
	}

	// Trailing days from next month
	for ( let i = 1; i <= trailingDays; i++ ) {
		const date = new Date( year, month + 1, i );
		days.push( {
			date,
			isCurrentMonth: false,
			events: eventsByDate[ formatLocalDate( date ) ] || [],
		} );
	}

	const today = new Date();
	today.setHours( 0, 0, 0, 0 );

	return (
		<div className="fair-events-calendar-grid">
			<div className="fair-events-calendar-weekdays">
				{ weekdayLabels.map( ( label, index ) => (
					<div key={ index } className="fair-events-calendar-weekday">
						{ label }
					</div>
				) ) }
			</div>
			<div className="fair-events-calendar-days">
				{ days.map( ( day, index ) => {
					const dayDate = new Date( day.date );
					dayDate.setHours( 0, 0, 0, 0 );
					const isToday = dayDate.getTime() === today.getTime();
					const isPast = dayDate < today;

					return (
						<DayCell
							key={ index }
							date={ day.date }
							events={ day.events }
							isCurrentMonth={ day.isCurrentMonth }
							isToday={ isToday }
							isPast={ isPast }
							onAddEvent={ onAddEvent }
							onEditEvent={ onEditEvent }
						/>
					);
				} ) }
			</div>
		</div>
	);
}
