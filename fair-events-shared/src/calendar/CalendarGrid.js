/**
 * Calendar Grid Component
 *
 * 7-column CSS grid of day cells for one month. Below 600px the same markup
 * collapses into an agenda list of the days that have events (style.css).
 * With `collapsePastDays`, the current month's agenda groups earlier days into
 * a collapsed "Past events" disclosure.
 *
 * @package FairEventsShared
 */

import { getWeekdayLabels } from '../calendarUtils.js';
import { getCalendarDays } from './month.js';
import DayCell from './DayCell.js';
import useAgendaLayout from './useAgendaLayout.js';

/**
 * Whether `date` falls in the same month as `today`.
 *
 * @param {Date} date  Displayed month.
 * @param {Date} today Local midnight today.
 * @return {boolean} True for the current month.
 */
function isSameMonth( date, today ) {
	return (
		date.getFullYear() === today.getFullYear() &&
		date.getMonth() === today.getMonth()
	);
}

export default function CalendarGrid( {
	currentDate,
	events,
	startOfWeek = 1,
	onAddEvent,
	manageEventUrl,
	forceGrid = false,
	showEmptyMessage = false,
	collapsePastDays = false,
	labels,
} ) {
	const weekdayLabels = getWeekdayLabels( startOfWeek );
	const days = getCalendarDays( currentDate, startOfWeek, events );

	const today = new Date();
	today.setHours( 0, 0, 0, 0 );

	// Past days collapse only in the mobile agenda of the current month, so
	// the first screen shows today and what's coming (#2446).
	const canCollapse =
		collapsePastDays && ! forceGrid && isSameMonth( currentDate, today );
	const isAgenda = useAgendaLayout( canCollapse );

	const cells = days.map( ( day, index ) => {
		const dayDate = new Date( day.date );
		dayDate.setHours( 0, 0, 0, 0 );
		const isToday = dayDate.getTime() === today.getTime();
		const isPast = dayDate < today;

		return {
			isCollapsible:
				isPast && day.isCurrentMonth && day.events.length > 0,
			element: (
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
			),
		};
	} );

	const pastCells =
		canCollapse && isAgenda
			? cells.filter( ( cell ) => cell.isCollapsible )
			: [];
	const visibleCells = pastCells.length
		? cells.filter( ( cell ) => ! cell.isCollapsible )
		: cells;

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
				{ pastCells.length > 0 && (
					<details className="fair-events-calendar-past">
						<summary className="fair-events-calendar-past-summary">
							{ labels.pastEvents }
						</summary>
						<div className="fair-events-calendar-past-days">
							{ pastCells.map( ( cell ) => cell.element ) }
						</div>
					</details>
				) }
				{ visibleCells.map( ( cell ) => cell.element ) }
				{ isAgendaEmpty && (
					<p className="fair-events-calendar-empty">
						{ labels.noEvents }
					</p>
				) }
			</div>
		</div>
	);
}
