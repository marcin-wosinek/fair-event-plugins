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

/**
 * Extract standalone event date ID from a uid string.
 * Standalone events use format: standalone_123@domain.com
 *
 * @param {string} uid Event uid.
 * @return {string|null} Event date ID or null.
 */
function getStandaloneId(uid) {
	const match = uid?.match(/standalone_(\d+)@/);
	return match ? match[1] : null;
}

/**
 * Get event link type from uid and url.
 *
 * @param {Object} event Event object with uid and url.
 * @return {string} 'post', 'external', or 'unlinked'.
 */
function getEventLinkType(event) {
	if (getEventPostId(event.uid)) {
		return 'post';
	}
	return event.url ? 'external' : 'unlinked';
}

/**
 * Extract event date ID from a uid string.
 * Post-linked: fair_event_{postId}_{eventDateId}@host
 * Standalone: standalone_{eventDateId}@host
 *
 * @param {string} uid Event uid.
 * @return {string|null} Event date ID or null.
 */
function getEventDateId(uid) {
	const standaloneMatch = uid?.match(/standalone_(\d+)@/);
	if (standaloneMatch) {
		return standaloneMatch[1];
	}

	const postMatch = uid?.match(/^fair_event_\d+_(\d+)@/);
	if (postMatch) {
		return postMatch[1];
	}

	return null;
}

/**
 * Build the URL for an event.
 * All local events link to the manage-event page.
 * Falls back to event.url for external/source events.
 *
 * @param {Object} event          Event object with uid and url.
 * @param {string} manageEventUrl Base URL for managing events.
 * @return {string|null} URL or null.
 */
function getEventEditUrl(event, manageEventUrl) {
	const eventDateId = getEventDateId(event.uid);
	if (eventDateId && manageEventUrl) {
		return `${manageEventUrl}&event_date_id=${eventDateId}`;
	}

	if (event.url) {
		return event.url;
	}

	return null;
}

export default function DayCell({
	date,
	events,
	isCurrentMonth,
	isToday,
	isPast,
	onAddEvent,
	manageEventUrl,
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
						const linkType = getEventLinkType(event);
						const linkTypeIcon =
							linkType === 'post'
								? 'dashicons-admin-post'
								: linkType === 'external'
								? 'dashicons-admin-links'
								: 'dashicons-editor-unlink';
						const categoryNames =
							event.categories?.map((c) => c.name) || [];
						const tooltip = categoryNames.length
							? `${event.title}\n${categoryNames.join(', ')}`
							: event.title;
						const eventUrl = getEventEditUrl(event, manageEventUrl);
						return (
							<div
								key={index}
								className={`fair-events-calendar-event-row link-type-${linkType}`}
							>
								{eventUrl ? (
									<a
										href={eventUrl}
										className="fair-events-calendar-event"
										title={tooltip}
									>
										<span
											className={`dashicons ${linkTypeIcon} fair-events-calendar-event-icon`}
										/>
										{event.title}
										{categoryNames.length > 0 && (
											<span className="fair-events-calendar-event-categories">
												{categoryNames.join(', ')}
											</span>
										)}
									</a>
								) : (
									<span
										className="fair-events-calendar-event fair-events-calendar-event-readonly"
										title={tooltip}
									>
										<span
											className={`dashicons ${linkTypeIcon} fair-events-calendar-event-icon`}
										/>
										{event.title}
										{categoryNames.length > 0 && (
											<span className="fair-events-calendar-event-categories">
												{categoryNames.join(', ')}
											</span>
										)}
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
