/**
 * Calendar Grid Component
 *
 * Generates 7-column CSS grid calendar with day cells.
 *
 * @package FairEvents
 */

import DayCell from './DayCell.js';

/**
 * Format a date as YYYY-MM-DD in local time (not UTC)
 *
 * @param {Date} date - Date object to format
 * @return {string} Date string in YYYY-MM-DD format
 */
function formatLocalDate(date) {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export default function CalendarGrid({
	currentDate,
	events,
	onAddEvent,
	onEditEvent,
}) {
	// Get start_of_week setting (0 = Sunday, 1 = Monday)
	const startOfWeek = window.fairEventsCalendarData?.startOfWeek ?? 1;

	const year = currentDate.getFullYear();
	const month = currentDate.getMonth();

	const firstDayOfMonth = new Date(year, month, 1);
	const lastDayOfMonth = new Date(year, month + 1, 0);
	const daysInMonth = lastDayOfMonth.getDate();

	// Calculate first weekday (adjusted for start_of_week)
	let firstWeekday = firstDayOfMonth.getDay();
	if (startOfWeek === 1) {
		firstWeekday = firstWeekday === 0 ? 6 : firstWeekday - 1;
	}

	// Calculate total cells needed
	const totalCells = firstWeekday + daysInMonth;
	const trailingDays = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);

	// Generate weekday labels
	const weekdayLabels = [];
	const baseDate = new Date(2024, 0, 7); // Known Sunday
	for (let i = 0; i < 7; i++) {
		const dayIndex = (startOfWeek + i) % 7;
		const date = new Date(baseDate);
		date.setDate(baseDate.getDate() + dayIndex);
		weekdayLabels.push(
			date.toLocaleDateString(undefined, { weekday: 'short' })
		);
	}

	// Group events by date (using local time, not UTC)
	const eventsByDate = {};
	events.forEach((event) => {
		const startDate = event.start ? new Date(event.start) : null;
		const endDate = event.end ? new Date(event.end) : startDate;

		if (!startDate) return;

		// Normalize dates to midnight for comparison (local time)
		const startDateStr = formatLocalDate(startDate);
		const endDateStr = endDate ? formatLocalDate(endDate) : startDateStr;

		// Add event to all days it spans
		let loopDate = new Date(
			startDate.getFullYear(),
			startDate.getMonth(),
			startDate.getDate()
		);
		const endLoop = new Date(
			endDate.getFullYear(),
			endDate.getMonth(),
			endDate.getDate()
		);

		while (loopDate <= endLoop) {
			const dateKey = formatLocalDate(loopDate);
			if (!eventsByDate[dateKey]) {
				eventsByDate[dateKey] = [];
			}
			eventsByDate[dateKey].push(event);
			loopDate.setDate(loopDate.getDate() + 1);
		}
	});

	// Build calendar days array
	const days = [];

	// Leading days from previous month
	for (let i = firstWeekday - 1; i >= 0; i--) {
		const date = new Date(year, month, -i);
		days.push({
			date,
			isCurrentMonth: false,
			events: eventsByDate[formatLocalDate(date)] || [],
		});
	}

	// Days in current month
	for (let day = 1; day <= daysInMonth; day++) {
		const date = new Date(year, month, day);
		days.push({
			date,
			isCurrentMonth: true,
			events: eventsByDate[formatLocalDate(date)] || [],
		});
	}

	// Trailing days from next month
	for (let i = 1; i <= trailingDays; i++) {
		const date = new Date(year, month + 1, i);
		days.push({
			date,
			isCurrentMonth: false,
			events: eventsByDate[formatLocalDate(date)] || [],
		});
	}

	const today = new Date();
	today.setHours(0, 0, 0, 0);

	return (
		<div className="fair-events-calendar-grid">
			<div className="fair-events-calendar-weekdays">
				{weekdayLabels.map((label, index) => (
					<div key={index} className="fair-events-calendar-weekday">
						{label}
					</div>
				))}
			</div>
			<div className="fair-events-calendar-days">
				{days.map((day, index) => {
					const dayDate = new Date(day.date);
					dayDate.setHours(0, 0, 0, 0);
					const isToday = dayDate.getTime() === today.getTime();
					const isPast = dayDate < today;

					return (
						<DayCell
							key={index}
							date={day.date}
							events={day.events}
							isCurrentMonth={day.isCurrentMonth}
							isToday={isToday}
							isPast={isPast}
							onAddEvent={onAddEvent}
							onEditEvent={onEditEvent}
						/>
					);
				})}
			</div>
		</div>
	);
}
