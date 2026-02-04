/**
 * WordPress dependencies
 */
import { useBlockProps } from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

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

	const { eventStart, eventEnd, eventAllDay, venueId } = useSelect(
		(select) => {
			if (!isEventContext) {
				return {
					eventStart: null,
					eventEnd: null,
					eventAllDay: false,
					venueId: null,
				};
			}

			const { getEditedPostAttribute } = select('core/editor');
			const meta = getEditedPostAttribute('meta') || {};

			return {
				eventStart: meta.event_start || '',
				eventEnd: meta.event_end || '',
				eventAllDay: meta.event_all_day || false,
				venueId: meta.event_venue_id || null,
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

	const formattedDate =
		isEventContext && eventStart
			? formatDateRange(eventStart, eventEnd, eventAllDay)
			: '';

	return (
		<div {...blockProps}>
			{isEventContext ? (
				<>
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
