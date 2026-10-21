/**
 * Translated labels for the shared month calendar.
 *
 * @package FairEvents
 */

import { __, _n, sprintf } from '@wordpress/i18n';

/**
 * Labels passed to the shared CalendarHeader and CalendarGrid.
 *
 * @return {Object} Labels (see fair-events-shared/src/calendar/README.md).
 */
export function getCalendarLabels() {
	return {
		previous: __( 'Previous', 'fair-events' ),
		today: __( 'Today', 'fair-events' ),
		next: __( 'Next', 'fair-events' ),
		addEvent: __( 'Add event', 'fair-events' ),
		untitled: __( '(untitled event)', 'fair-events' ),
		openDestination: __( 'Open link destination', 'fair-events' ),
		noEvents: __( 'No events this month.', 'fair-events' ),
		more: ( count ) =>
			sprintf(
				/* translators: %d: number of additional events */
				_n( '+%d more', '+%d more', count, 'fair-events' ),
				count
			),
	};
}
