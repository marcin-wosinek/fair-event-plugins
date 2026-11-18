/**
 * Calendar organizer field - Entry Point
 *
 * Adds the organizer to the fair-events calendar's Create Event popup, above
 * Categories, via a filter (#2305). PHP enqueues this script only for
 * administrators while organizers are available, so the field is absent
 * otherwise.
 *
 * @package FairEventsExperimental
 */

import { addFilter } from '@wordpress/hooks';
import CalendarOrganizerField, {
	FIELD_NAME,
	organizerRequestData,
} from './CalendarOrganizerField.js';

addFilter(
	'fairEvents.calendar.quickEventFields',
	'fair-events-experimental/organizer-field',
	( fields ) => [
		...fields,
		{
			name: FIELD_NAME,
			render: ( props ) => <CalendarOrganizerField { ...props } />,
			requestData: organizerRequestData,
		},
	]
);
