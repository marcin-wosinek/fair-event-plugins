/**
 * WordPress dependencies
 */
import { useBlockProps } from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';
import { __ } from '@wordpress/i18n';

/**
 * Format event date range
 *
 * @param {string} startDateTime - Start datetime string
 * @param {string} endDateTime   - End datetime string
 * @param {boolean} allDay       - Whether event is all-day
 * @return {string} Formatted date range
 */
function formatDateRange( startDateTime, endDateTime, allDay ) {
	if ( ! startDateTime ) {
		return '';
	}

	const startDate = new Date( startDateTime );
	const endDate = endDateTime ? new Date( endDateTime ) : null;
	const currentYear = new Date().getFullYear();

	if ( allDay ) {
		// All-day events: "1-4 October" or "31 October—2 November"
		const startDay = startDate.getDate();
		const startMonth = startDate.toLocaleString( 'en-US', {
			month: 'long',
		} );
		const startYear = startDate.getFullYear();

		if ( endDate ) {
			const endDay = endDate.getDate();
			const endMonth = endDate.toLocaleString( 'en-US', {
				month: 'long',
			} );
			const endYear = endDate.getFullYear();

			// Same month and year
			if ( startMonth === endMonth && startYear === endYear ) {
				if ( startDay === endDay ) {
					// Single day: "15 October"
					return `${ startDay } ${ startMonth }`;
				} else {
					// Same month: "1–4 October"
					return `${ startDay }–${ endDay } ${ startMonth }`;
				}
			} else if ( startYear === endYear ) {
				// Different months, same year: "31 October—2 November"
				return `${ startDay } ${ startMonth }—${ endDay } ${ endMonth }`;
			} else {
				// Different years: "31 December 2024—2 January 2025"
				return `${ startDay } ${ startMonth } ${ startYear }—${ endDay } ${ endMonth } ${ endYear }`;
			}
		} else {
			// Only start date: "15 October"
			return `${ startDay } ${ startMonth }`;
		}
	} else {
		// Timed events: "19:30—21:30, 15th October" or "22:00 15th November—03:00 16 November"
		const startTime = startDate
			.toLocaleTimeString( 'en-GB', {
				hour: '2-digit',
				minute: '2-digit',
				hour12: false,
			} )
			.replace( ':', ':' );
		const startDay = startDate.getDate();
		const startDayOrdinal = getOrdinalSuffix( startDay );
		const startMonth = startDate.toLocaleString( 'en-US', {
			month: 'long',
		} );
		const startYear = startDate.getFullYear();

		if ( endDate ) {
			const endTime = endDate
				.toLocaleTimeString( 'en-GB', {
					hour: '2-digit',
					minute: '2-digit',
					hour12: false,
				} )
				.replace( ':', ':' );
			const endDay = endDate.getDate();
			const endDayOrdinal = getOrdinalSuffix( endDay );
			const endMonth = endDate.toLocaleString( 'en-US', {
				month: 'long',
			} );
			const endYear = endDate.getFullYear();

			let startDateStr = `${ startDay }${ startDayOrdinal } ${ startMonth }`;
			let endDateStr = `${ endDay }${ endDayOrdinal } ${ endMonth }`;

			// Add year if different from current year
			if ( startYear !== currentYear ) {
				startDateStr += ` ${ startYear }`;
			}
			if ( endYear !== currentYear ) {
				endDateStr += ` ${ endYear }`;
			}

			// Check if same day
			const startDateOnly = startDate.toISOString().split( 'T' )[ 0 ];
			const endDateOnly = endDate.toISOString().split( 'T' )[ 0 ];

			if ( startDateOnly === endDateOnly ) {
				// Same day: "19:30—21:30, 15th October"
				return `${ startTime }—${ endTime }, ${ startDateStr }`;
			} else {
				// Different days: "22:00 15th November—03:00 16 November"
				return `${ startTime } ${ startDateStr }—${ endTime } ${ endDateStr }`;
			}
		} else {
			// Only start time: "19:30, 15th October"
			let startDateStr = `${ startDay }${ startDayOrdinal } ${ startMonth }`;
			if ( startYear !== currentYear ) {
				startDateStr += ` ${ startYear }`;
			}
			return `${ startTime }, ${ startDateStr }`;
		}
	}
}

/**
 * Get ordinal suffix for a number (1st, 2nd, 3rd, etc.)
 *
 * @param {number} num - The number
 * @return {string} Ordinal suffix
 */
function getOrdinalSuffix( num ) {
	const j = num % 10;
	const k = num % 100;
	if ( j === 1 && k !== 11 ) {
		return 'st';
	}
	if ( j === 2 && k !== 12 ) {
		return 'nd';
	}
	if ( j === 3 && k !== 13 ) {
		return 'rd';
	}
	return 'th';
}

/**
 * Edit component for Event Dates block
 *
 * @param {Object} props            - Component props
 * @param {Object} props.context    - Block context (postId, postType)
 * @return {JSX.Element} The edit component
 */
export default function EditComponent( { context } ) {
	const blockProps = useBlockProps();
	const { postId, postType } = context;

	// Check if we're in an event post context
	const isEventContext = postType === 'fair_event' && postId;

	// Get event metadata from the editor store
	const { eventStart, eventEnd, eventAllDay } = useSelect(
		( select ) => {
			if ( ! isEventContext ) {
				return {
					eventStart: null,
					eventEnd: null,
					eventAllDay: false,
				};
			}

			const { getEditedPostAttribute } = select( 'core/editor' );
			const meta = getEditedPostAttribute( 'meta' ) || {};

			return {
				eventStart: meta.event_start || '',
				eventEnd: meta.event_end || '',
				eventAllDay: meta.event_all_day || false,
			};
		},
		[ isEventContext, postId ]
	);

	const formattedDate =
		isEventContext && eventStart
			? formatDateRange( eventStart, eventEnd, eventAllDay )
			: '';

	return (
		<div { ...blockProps }>
			{ isEventContext ? (
				<div className="event-dates">
					{ formattedDate || (
						<em style={ { color: '#999' } }>
							{ __(
								'No event dates set. Add dates in the Event Details panel.',
								'fair-events'
							) }
						</em>
					) }
				</div>
			) : (
				<p style={ { fontStyle: 'italic', color: '#999' } }>
					{ __(
						'Event Dates block: Only displays in event post context.',
						'fair-events'
					) }
				</p>
			) }
		</div>
	);
}
