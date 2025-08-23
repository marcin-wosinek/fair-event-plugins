/**
 * Recurring Events Calendar Component
 * Shows a calendar with highlighted days where event instances occur
 */

import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	format,
	startOfMonth,
	endOfMonth,
	eachDayOfInterval,
	getDay,
	addMonths,
	subMonths,
	isSameDay,
	isSameMonth,
} from 'date-fns';
import { rruleManager } from '../utils/rruleManager.js';

/**
 * Calendar component that highlights recurring event dates
 *
 * @param {Object} props Component props
 * @param {string} props.startDate Start date of the event
 * @param {Object} props.recurrence Recurrence configuration
 * @param {Array<string>} props.exceptionDates Array of exception dates to exclude
 * @param {Function} props.onDateClick Function to handle date clicks for toggling exceptions
 * @return {JSX.Element} Calendar component
 */
export default function RecurringEventsCalendar({
	startDate,
	recurrence,
	exceptionDates,
	onDateClick,
}) {
	const [currentMonth, setCurrentMonth] = useState(new Date());
	const [eventDates, setEventDates] = useState([]);

	// Generate event dates whenever startDate, recurrence, or exceptionDates changes
	useEffect(() => {
		if (!startDate || !recurrence?.frequency) {
			setEventDates([]);
			return;
		}

		// Generate up to 50 events to show more instances in the calendar
		const events = rruleManager.generateEvents(
			recurrence,
			startDate,
			50,
			exceptionDates
		);
		setEventDates(events);
	}, [startDate, recurrence, exceptionDates]);

	// Get the start and end of the current month
	const monthStart = startOfMonth(currentMonth);
	const monthEnd = endOfMonth(currentMonth);

	// Get all days in the current month
	const monthDays = eachDayOfInterval({ start: monthStart, end: monthEnd });

	// Calculate padding days at the start of the month
	const startPadding = getDay(monthStart);
	const paddingDays = Array(startPadding).fill(null);

	// Navigate to previous month
	const goToPreviousMonth = () => {
		setCurrentMonth((prev) => subMonths(prev, 1));
	};

	// Navigate to next month
	const goToNextMonth = () => {
		setCurrentMonth((prev) => addMonths(prev, 1));
	};

	// Check if a date has an event
	const hasEvent = (date) => {
		return eventDates.some((eventDate) => isSameDay(eventDate, date));
	};

	// Check if a given day is the end date
	const isEndDate = (day) => {
		return recurrence?.until && isSameDay(new Date(recurrence.until), day);
	};

	// Check if a given day is an exception date
	const isExceptionDate = (day) => {
		return (
			exceptionDates &&
			Array.isArray(exceptionDates) &&
			exceptionDates.some((exceptionDate) =>
				isSameDay(new Date(exceptionDate), day)
			)
		);
	};

	// Handle clicking on a calendar date
	const handleDateClick = (day) => {
		if (onDateClick && (hasEvent(day) || isExceptionDate(day))) {
			const dateString = format(day, 'yyyy-MM-dd');
			onDateClick(dateString);
		}
	};

	// Get event dates for the current month
	const currentMonthEvents = eventDates.filter((eventDate) =>
		isSameMonth(eventDate, currentMonth)
	);

	const weekDays = [
		__('Sun', 'fair-calendar-button'),
		__('Mon', 'fair-calendar-button'),
		__('Tue', 'fair-calendar-button'),
		__('Wed', 'fair-calendar-button'),
		__('Thu', 'fair-calendar-button'),
		__('Fri', 'fair-calendar-button'),
		__('Sat', 'fair-calendar-button'),
	];

	if (!recurrence?.frequency || !startDate) {
		return null;
	}

	return (
		<div className="recurring-events-calendar">
			<div className="calendar-header">
				<div className="calendar-navigation">
					<button
						type="button"
						onClick={goToPreviousMonth}
						className="calendar-nav-button"
						aria-label={__(
							'Previous month',
							'fair-calendar-button'
						)}
					>
						‹
					</button>
					<span className="calendar-month">
						{format(currentMonth, 'MMMM yyyy')}
					</span>
					<button
						type="button"
						onClick={goToNextMonth}
						className="calendar-nav-button"
						aria-label={__('Next month', 'fair-calendar-button')}
					>
						›
					</button>
				</div>
			</div>

			<div className="calendar-grid">
				<div className="calendar-weekdays">
					{weekDays.map((day) => (
						<div key={day} className="calendar-weekday">
							{day}
						</div>
					))}
				</div>

				<div className="calendar-days">
					{paddingDays.map((_, index) => (
						<div
							key={`padding-${index}`}
							className="calendar-day-padding"
						></div>
					))}

					{monthDays.map((day) => {
						const hasEventDay = hasEvent(day);
						const isEndDay = isEndDate(day);
						const isExceptionDay = isExceptionDate(day);
						const isClickable = hasEventDay || isExceptionDay;
						let className = 'calendar-day';
						let title = '';

						if (hasEventDay) {
							className += ' has-event';
							title = __(
								'Event occurs on this day - click to exclude',
								'fair-calendar-button'
							);
						}
						if (isEndDay) {
							className += ' is-end-date';
							title = hasEventDay
								? __(
										'Event occurs on this day (last occurrence) - click to exclude',
										'fair-calendar-button'
									)
								: __(
										'Last occurrence date',
										'fair-calendar-button'
									);
						}
						if (isExceptionDay) {
							className += ' is-exception-date';
							title = __(
								'Event excluded on this day - click to include',
								'fair-calendar-button'
							);
						}
						if (isClickable) {
							className += ' is-clickable';
						}

						return (
							<div
								key={day.toISOString()}
								className={className}
								title={title}
								onClick={() => handleDateClick(day)}
								style={{
									cursor: isClickable ? 'pointer' : 'default',
								}}
							>
								{format(day, 'd')}
							</div>
						);
					})}
				</div>
			</div>

			{currentMonthEvents.length > 0 && (
				<div className="calendar-events-summary">
					<p className="components-base-control__help">
						{currentMonthEvents.length === 1
							? __(
									'1 event occurrence in this month',
									'fair-calendar-button'
								)
							: __(
									'%d event occurrences in this month',
									'fair-calendar-button'
								).replace('%d', currentMonthEvents.length)}
					</p>
				</div>
			)}
		</div>
	);
}
