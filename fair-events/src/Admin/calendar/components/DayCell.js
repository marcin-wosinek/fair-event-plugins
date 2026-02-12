/**
 * Day Cell Component
 *
 * Individual day cell with day number, add button, and event list.
 *
 * @package FairEvents
 */

import { Button } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

const MAX_VISIBLE_EVENTS = 3;

/**
 * Extract the event post ID from a uid string.
 * Post-linked events use format: fair_event_{id}_...@ or fair_event_{id}@
 * Returns null for standalone or non-post events.
 *
 * @param {string} uid Event uid.
 * @return {string|null} Event post ID or null.
 */
function getEventPostId(uid) {
	const match = uid?.match(/^fair_event_(\d+)(?:_\d+)?@/);
	return match ? match[1] : null;
}

export default function DayCell({
	date,
	events,
	isCurrentMonth,
	isToday,
	isPast,
	onAddEvent,
	onEditEvent,
	participantsUrl,
}) {
	const dayNumber = date.getDate();
	const hasEvents = events.length > 0;
	const visibleEvents = events.slice(0, MAX_VISIBLE_EVENTS);
	const hiddenCount = events.length - MAX_VISIBLE_EVENTS;

	const cellClasses = [
		'fair-events-calendar-day',
		isCurrentMonth ? 'current-month' : 'other-month',
		isToday ? 'today' : '',
		isPast ? 'past' : '',
		hasEvents ? 'has-events' : '',
	]
		.filter(Boolean)
		.join(' ');

	const handleAddClick = (e) => {
		e.stopPropagation();
		onAddEvent(date);
	};

	const handleEventClick = (e, eventUid) => {
		e.stopPropagation();
		onEditEvent(eventUid);
	};

	return (
		<div className={cellClasses}>
			<div className="fair-events-calendar-day-header">
				<span className="fair-events-calendar-day-number">
					{dayNumber}
				</span>
				{onAddEvent && (
					<Button
						className="fair-events-calendar-add-btn"
						onClick={handleAddClick}
						label={__('Add event', 'fair-events')}
						icon="plus"
						size="small"
					/>
				)}
			</div>
			{hasEvents && (
				<div className="fair-events-calendar-day-events">
					{visibleEvents.map((event, index) => {
						const eventPostId = getEventPostId(event.uid);
						return (
							<div
								key={index}
								className="fair-events-calendar-event-row"
							>
								{onEditEvent ? (
									<button
										type="button"
										className="fair-events-calendar-event"
										onClick={(e) =>
											handleEventClick(e, event.uid)
										}
										title={event.title}
									>
										{event.title}
									</button>
								) : (
									<span
										className="fair-events-calendar-event fair-events-calendar-event-readonly"
										title={event.title}
									>
										{event.title}
									</span>
								)}
								{participantsUrl && eventPostId && (
									<a
										href={`${participantsUrl}${eventPostId}`}
										className="fair-events-calendar-participants-link"
										title={__(
											'View Participants',
											'fair-events'
										)}
										onClick={(e) => e.stopPropagation()}
									>
										<span className="dashicons dashicons-groups" />
									</a>
								)}
							</div>
						);
					})}
					{hiddenCount > 0 && (
						<span className="fair-events-calendar-more">
							{sprintf(
								/* translators: %d: number of additional events */
								__('+%d more', 'fair-events'),
								hiddenCount
							)}
						</span>
					)}
				</div>
			)}
		</div>
	);
}
