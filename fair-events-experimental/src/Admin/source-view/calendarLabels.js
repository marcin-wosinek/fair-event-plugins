/**
 * Translated labels for the shared month calendar.
 *
 * @package FairEventsExperimental
 */

import { __, _n, sprintf } from '@wordpress/i18n';

/**
 * Labels passed to the shared CalendarHeader and CalendarGrid. Feed previews
 * have no creation actions, so there is no Add event label.
 *
 * @return {Object} Labels (see fair-events-shared/src/calendar/README.md).
 */
export function getCalendarLabels() {
	return {
		previous: __( 'Previous', 'fair-events-experimental' ),
		today: __( 'Today', 'fair-events-experimental' ),
		next: __( 'Next', 'fair-events-experimental' ),
		untitled: __( '(untitled event)', 'fair-events-experimental' ),
		openDestination: __(
			'Open link destination',
			'fair-events-experimental'
		),
		noEvents: __( 'No events this month.', 'fair-events-experimental' ),
		more: ( count ) =>
			sprintf(
				/* translators: %d: number of additional events */
				_n( '+%d more', '+%d more', count, 'fair-events-experimental' ),
				count
			),
	};
}
