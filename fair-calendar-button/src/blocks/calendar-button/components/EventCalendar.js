/**
 * Event Calendar Component - Shows recurring event dates visually
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import {
	format,
	startOfMonth,
	endOfMonth,
	eachDayOfInterval,
	isSameMonth,
	isSameDay,
	addMonths,
	subMonths,
	parseISO,
	isValid,
	addWeeks,
	addDays,
} from 'date-fns';

/**
 * Generate event dates based on RRULE-like parameters
 *
 * @param {string} startDate - Start date string
 * @param {string} frequency - Frequency (DAILY, WEEKLY, BIWEEKLY)
 * @param {number|null} count - Number of occurrences
 * @param {string} untilDate - Until date string
 * @return {Date[]} Array of event dates
 */
function generateEventDates(startDate, frequency, count, untilDate) {
	if (!startDate || !frequency) return [];

	try {
		const start = parseISO(startDate);
		if (!isValid(start)) return [];

		const dates = [start];
		let currentDate = start;
		let occurrences = 1;

		// Calculate end constraint
		const maxOccurrences = count || 12; // Default to 12 if no count specified
		const until = untilDate ? parseISO(untilDate) : null;

		while (occurrences < maxOccurrences) {
			let nextDate;

			switch (frequency) {
				case 'DAILY':
					nextDate = addDays(currentDate, 1);
					break;
				case 'WEEKLY':
					nextDate = addWeeks(currentDate, 1);
					break;
				case 'BIWEEKLY':
					nextDate = addWeeks(currentDate, 2);
					break;
				default:
					return dates;
			}

			// Check if we've exceeded the until date
			if (until && nextDate > until) {
				break;
			}

			dates.push(nextDate);
			currentDate = nextDate;
			occurrences++;
		}

		return dates;
	} catch (error) {
		console.error('Error generating event dates:', error);
		return [];
	}
}

/**
 * Event Calendar Component
 *
 * @param {Object} props - Component props
 * @param {string} props.startDate - Start date string
 * @param {string} props.frequency - Frequency (DAILY, WEEKLY, BIWEEKLY)
 * @param {number|null} props.count - Number of occurrences
 * @param {string} props.untilDate - Until date string
 * @return {JSX.Element} Calendar component
 */
export default function EventCalendar({
	startDate,
	frequency,
	count,
	untilDate,
}) {
	const [currentMonth, setCurrentMonth] = useState(() => {
		if (startDate) {
			try {
				const start = parseISO(startDate);
				return isValid(start) ? start : new Date();
			} catch {
				return new Date();
			}
		}
		return new Date();
	});

	const [eventDates, setEventDates] = useState([]);

	// Update event dates when parameters change
	useEffect(() => {
		const dates = generateEventDates(
			startDate,
			frequency,
			count,
			untilDate
		);
		setEventDates(dates);
	}, [startDate, frequency, count, untilDate]);

	// Generate calendar days for current month
	const monthStart = startOfMonth(currentMonth);
	const monthEnd = endOfMonth(currentMonth);
	const calendarDays = eachDayOfInterval({
		start: monthStart,
		end: monthEnd,
	});

	// Check if a date has an event
	const hasEvent = (date) => {
		return eventDates.some((eventDate) => isSameDay(eventDate, date));
	};

	// Navigation handlers
	const goToPreviousMonth = () => {
		setCurrentMonth((prev) => subMonths(prev, 1));
	};

	const goToNextMonth = () => {
		setCurrentMonth((prev) => addMonths(prev, 1));
	};

	return (
		<div className="event-calendar">
			<div className="event-calendar__header">
				<button
					type="button"
					className="event-calendar__nav-button"
					onClick={goToPreviousMonth}
					aria-label={__('Previous month', 'fair-calendar-button')}
				>
					‹
				</button>
				<h3 className="event-calendar__month-title">
					{format(currentMonth, 'MMMM yyyy')}
				</h3>
				<button
					type="button"
					className="event-calendar__nav-button"
					onClick={goToNextMonth}
					aria-label={__('Next month', 'fair-calendar-button')}
				>
					›
				</button>
			</div>

			<div className="event-calendar__weekdays">
				{['S', 'M', 'T', 'W', 'T', 'F', 'S'].map((day, index) => (
					<div key={index} className="event-calendar__weekday">
						{day}
					</div>
				))}
			</div>

			<div className="event-calendar__days">
				{calendarDays.map((day) => (
					<div
						key={day.toISOString()}
						className={`event-calendar__day ${
							hasEvent(day) ? 'event-calendar__day--event' : ''
						} ${
							!isSameMonth(day, currentMonth)
								? 'event-calendar__day--outside'
								: ''
						}`}
					>
						{format(day, 'd')}
					</div>
				))}
			</div>

			{eventDates.length > 0 && (
				<div className="event-calendar__summary">
					{__('Showing', 'fair-calendar-button')} {eventDates.length}{' '}
					{__('event dates', 'fair-calendar-button')}
				</div>
			)}
		</div>
	);
}
