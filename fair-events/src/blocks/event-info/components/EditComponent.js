/**
 * WordPress dependencies
 */
import { useBlockProps } from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

/**
 * Internal dependencies — import store to ensure it is registered
 */
import { STORE_NAME } from '../../../Admin/event-meta-box/store.js';

/**
 * Format event date range
 *
 * @param {string}  startDateTime - Start datetime string
 * @param {string}  endDateTime   - End datetime string
 * @param {boolean} allDay        - Whether event is all-day
 * @return {string} Formatted date range
 */
function formatDateRange(startDateTime, endDateTime, allDay) {
	if (!startDateTime) {
		return '';
	}

	const startDate = new Date(startDateTime);
	const endDate = endDateTime ? new Date(endDateTime) : null;
	const currentYear = new Date().getFullYear();

	if (allDay) {
		const startDay = startDate.getDate();
		const startMonth = startDate.toLocaleString('en-US', {
			month: 'long',
		});
		const startYear = startDate.getFullYear();

		if (endDate) {
			const endDay = endDate.getDate();
			const endMonth = endDate.toLocaleString('en-US', {
				month: 'long',
			});
			const endYear = endDate.getFullYear();

			if (startMonth === endMonth && startYear === endYear) {
				if (startDay === endDay) {
					return `${startDay} ${startMonth}`;
				} else {
					return `${startDay}–${endDay} ${startMonth}`;
				}
			} else if (startYear === endYear) {
				return `${startDay} ${startMonth}—${endDay} ${endMonth}`;
			} else {
				return `${startDay} ${startMonth} ${startYear}—${endDay} ${endMonth} ${endYear}`;
			}
		} else {
			return `${startDay} ${startMonth}`;
		}
	} else {
		const startTime = startDate
			.toLocaleTimeString('en-GB', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			})
			.replace(':', ':');
		const startDay = startDate.getDate();
		const startDayOrdinal = getOrdinalSuffix(startDay);
		const startMonth = startDate.toLocaleString('en-US', {
			month: 'long',
		});
		const startYear = startDate.getFullYear();

		if (endDate) {
			const endTime = endDate
				.toLocaleTimeString('en-GB', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: false,
				})
				.replace(':', ':');
			const endDay = endDate.getDate();
			const endDayOrdinal = getOrdinalSuffix(endDay);
			const endMonth = endDate.toLocaleString('en-US', {
				month: 'long',
			});
			const endYear = endDate.getFullYear();

			let startDateStr = `${startDay}${startDayOrdinal} ${startMonth}`;
			let endDateStr = `${endDay}${endDayOrdinal} ${endMonth}`;

			if (startYear !== currentYear) {
				startDateStr += ` ${startYear}`;
			}
			if (endYear !== currentYear) {
				endDateStr += ` ${endYear}`;
			}

			const startDateOnly = startDate.toISOString().split('T')[0];
			const endDateOnly = endDate.toISOString().split('T')[0];

			if (startDateOnly === endDateOnly) {
				return `${startTime}—${endTime}, ${startDateStr}`;
			} else {
				return `${startTime} ${startDateStr}—${endTime} ${endDateStr}`;
			}
		} else {
			let startDateStr = `${startDay}${startDayOrdinal} ${startMonth}`;
			if (startYear !== currentYear) {
				startDateStr += ` ${startYear}`;
			}
			return `${startTime}, ${startDateStr}`;
		}
	}
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 *
 * @param {number} num - The number
 * @return {string} Ordinal suffix
 */
function getOrdinalSuffix(num) {
	const j = num % 10;
	const k = num % 100;
	if (j === 1 && k !== 11) {
		return 'st';
	}
	if (j === 2 && k !== 12) {
		return 'nd';
	}
	if (j === 3 && k !== 13) {
		return 'rd';
	}
	return 'th';
}

/**
 * Parse an RRULE string into components
 *
 * @param {string} rrule - RRULE string (e.g. "FREQ=WEEKLY;COUNT=10")
 * @return {Object} Parsed components { freq, interval, count, until }
 */
function parseRRule(rrule) {
	const parts = {};
	rrule.split(';').forEach((part) => {
		const [key, val] = part.split('=');
		parts[key] = val;
	});
	return {
		freq: parts.FREQ || 'WEEKLY',
		interval: parseInt(parts.INTERVAL || '1', 10),
		count: parts.COUNT ? parseInt(parts.COUNT, 10) : null,
		until: parts.UNTIL || null,
	};
}

/**
 * Format recurrence description from an RRULE string
 *
 * @param {string} rrule         - RRULE string
 * @param {string} startDateTime - Start datetime to derive day-of-week
 * @return {string} Recurrence description (e.g. "Every Wednesday")
 */
function formatRecurrenceDescription(rrule, startDateTime) {
	const parsed = parseRRule(rrule);
	const { freq, interval } = parsed;

	const startDate = new Date(startDateTime);
	const dayName = startDate.toLocaleString('en-US', { weekday: 'long' });

	switch (freq) {
		case 'DAILY':
			if (interval > 1) {
				return sprintf(__('Every %d days', 'fair-events'), interval);
			}
			return __('Daily', 'fair-events');

		case 'WEEKLY':
			if (interval === 2) {
				return sprintf(
					__('Every 2 weeks on %s', 'fair-events'),
					dayName
				);
			}
			if (interval > 2) {
				return sprintf(
					__('Every %1$d weeks on %2$s', 'fair-events'),
					interval,
					dayName
				);
			}
			return sprintf(__('Every %s', 'fair-events'), dayName);

		case 'MONTHLY':
			if (interval > 1) {
				return sprintf(__('Every %d months', 'fair-events'), interval);
			}
			return __('Monthly', 'fair-events');

		case 'YEARLY':
			if (interval > 1) {
				return sprintf(__('Every %d years', 'fair-events'), interval);
			}
			return __('Yearly', 'fair-events');

		default:
			return '';
	}
}

/**
 * Format time range (without date) for recurring events
 *
 * @param {string} startDateTime - Start datetime
 * @param {string} endDateTime   - End datetime
 * @return {string} Formatted time range (e.g. "19:30—21:30")
 */
function formatTimeRange(startDateTime, endDateTime) {
	const startDate = new Date(startDateTime);
	const startTime = startDate
		.toLocaleTimeString('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			hour12: false,
		})
		.replace(':', ':');

	if (endDateTime) {
		const endDate = new Date(endDateTime);
		const endTime = endDate
			.toLocaleTimeString('en-GB', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			})
			.replace(':', ':');
		return `${startTime}—${endTime}`;
	}

	return startTime;
}

/**
 * Find the next upcoming occurrence from generated occurrences array
 *
 * @param {string}   masterStart           - Master start datetime
 * @param {Object[]} generatedOccurrences  - Array of generated occurrence objects
 * @return {Object|null} Next upcoming occurrence or null
 */
function findNextOccurrence(masterStart, generatedOccurrences) {
	const now = new Date();

	// Check master date first.
	if (masterStart && new Date(masterStart) >= now) {
		return { start_datetime: masterStart };
	}

	// Check generated occurrences.
	if (generatedOccurrences && generatedOccurrences.length) {
		for (const occ of generatedOccurrences) {
			if (new Date(occ.start_datetime) >= now) {
				return occ;
			}
		}
	}

	return null;
}

/**
 * Edit component for Event Info block
 *
 * @param {Object} props         - Component props
 * @param {Object} props.context - Block context (postId, postType)
 * @return {JSX.Element} The edit component
 */
export default function EditComponent({ context }) {
	const blockProps = useBlockProps();
	const { postId, postType } = context;
	const [venue, setVenue] = useState(null);

	const isEventContext = postType === 'fair_event' && postId;

	const {
		eventStart,
		eventEnd,
		eventAllDay,
		venueId,
		rrule,
		occurrenceType,
		generatedOccurrences,
	} = useSelect(
		(select) => {
			if (!isEventContext) {
				return {
					eventStart: null,
					eventEnd: null,
					eventAllDay: false,
					venueId: null,
					rrule: null,
					occurrenceType: 'single',
					generatedOccurrences: [],
				};
			}

			const eventData = select(STORE_NAME).getEventData();

			if (!eventData) {
				return {
					eventStart: null,
					eventEnd: null,
					eventAllDay: false,
					venueId: null,
					rrule: null,
					occurrenceType: 'single',
					generatedOccurrences: [],
				};
			}

			return {
				eventStart: eventData.start_datetime || '',
				eventEnd: eventData.end_datetime || '',
				eventAllDay: eventData.all_day || false,
				venueId: eventData.venue_id || null,
				rrule: eventData.rrule || null,
				occurrenceType: eventData.occurrence_type || 'single',
				generatedOccurrences: eventData.generated_occurrences || [],
			};
		},
		[isEventContext, postId]
	);

	useEffect(() => {
		if (venueId) {
			apiFetch({ path: `/fair-events/v1/venues/${venueId}` })
				.then((data) => setVenue(data))
				.catch(() => setVenue(null));
		} else {
			setVenue(null);
		}
	}, [venueId]);

	const isRecurring = occurrenceType === 'master' && rrule && eventStart;

	const formattedDate =
		isEventContext && eventStart && !isRecurring
			? formatDateRange(eventStart, eventEnd, eventAllDay)
			: '';

	const recurrenceDesc =
		isRecurring && eventStart
			? (() => {
					let desc = formatRecurrenceDescription(rrule, eventStart);
					if (!eventAllDay) {
						const timeRange = formatTimeRange(eventStart, eventEnd);
						desc = desc + ', ' + timeRange;
					}
					return desc;
			  })()
			: '';

	const nextOccurrence = isRecurring
		? findNextOccurrence(eventStart, generatedOccurrences)
		: null;

	const nextOccurrenceLabel = nextOccurrence
		? (() => {
				const d = new Date(nextOccurrence.start_datetime);
				const day = d.getDate();
				const month = d.toLocaleString('en-US', { month: 'long' });
				return sprintf(
					__('Next: %s', 'fair-events'),
					`${day} ${month}`
				);
		  })()
		: '';

	return (
		<div {...blockProps}>
			{isEventContext ? (
				<>
					{isRecurring ? (
						<>
							<div className="wp-block-fair-events-event-info__dates">
								{recurrenceDesc}
							</div>
							{nextOccurrenceLabel && (
								<div className="wp-block-fair-events-event-info__next-occurrence">
									{nextOccurrenceLabel}
								</div>
							)}
						</>
					) : (
						<div className="wp-block-fair-events-event-info__dates">
							{formattedDate || (
								<em style={{ color: '#999' }}>
									{__(
										'No event dates set. Add dates in the Event Details panel.',
										'fair-events'
									)}
								</em>
							)}
						</div>
					)}
					{venue ? (
						<div className="wp-block-fair-events-event-info__venue">
							<div className="wp-block-fair-events-event-info__venue-name">
								{venue.google_maps_link ? (
									<a
										href={venue.google_maps_link}
										target="_blank"
										rel="noopener noreferrer"
									>
										{venue.name}
									</a>
								) : (
									venue.name
								)}
							</div>
							{venue.address && (
								<div className="wp-block-fair-events-event-info__venue-address">
									{venue.address}
								</div>
							)}
						</div>
					) : venueId ? (
						<div className="wp-block-fair-events-event-info__venue">
							<em style={{ color: '#999' }}>
								{__('Loading venue...', 'fair-events')}
							</em>
						</div>
					) : null}
				</>
			) : (
				<p style={{ fontStyle: 'italic', color: '#999' }}>
					{__(
						'Event Info block: Only displays in event post context.',
						'fair-events'
					)}
				</p>
			)}
		</div>
	);
}
