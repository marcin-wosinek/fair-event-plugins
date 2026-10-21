/**
 * Calendar Grid Component
 *
 * 7-column CSS grid of day cells for one month. Below 600px the same markup
 * collapses into an agenda list of the days that have events (style.css).
 *
 * @package FairEventsShared
 */

import { getWeekdayLabels } from '../calendarUtils.js';
import { getCalendarDays } from './month.js';
import DayCell from './DayCell.js';

export default function CalendarGrid( {
	currentDate,
	events,
	startOfWeek = 1,
	onAddEvent,
	manageEventUrl,
	forceGrid = false,
	showEmptyMessage = false,
	labels,
} ) {
	const weekdayLabels = getWeekdayLabels( startOfWeek );
	const days = getCalendarDays( currentDate, startOfWeek, events );

	const today = new Date();
	today.setHours( 0, 0, 0, 0 );

	// The mobile agenda only lists current-month days that have events, so it
	// renders nothing at all for a month like this. Grid mode hides the notice,
	// and a forced grid (an empty category filter, #1850) has its own message.
	// Consumers enable it only after a successful load, so a failed request
	// isn't reported as an empty month.
	const isAgendaEmpty =
		showEmptyMessage &&
		! forceGrid &&
		! days.some( ( day ) => day.isCurrentMonth && day.events.length > 0 );

	return (
		<div
			className={
				forceGrid
					? 'fair-events-calendar-grid is-grid-forced'
					: 'fair-events-calendar-grid'
			}
		>
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
							manageEventUrl={ manageEventUrl }
							labels={ labels }
						/>
					);
				} ) }
				{ isAgendaEmpty && (
					<p className="fair-events-calendar-empty">
						{ labels.noEvents }
					</p>
				) }
			</div>
		</div>
	);
}
