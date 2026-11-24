/**
 * Manage Event team members section - Entry Point
 *
 * Adds the event's team to the fair-events Manage Event page's Event
 * Details via a filter (#2394). PHP enqueues this script only for
 * administrators while the `team-members` bundle is on, so the section is
 * absent otherwise.
 *
 * @package FairEventsExperimental
 */

import { addFilter } from '@wordpress/hooks';
import EventTeamMembers, { SECTION_NAME } from './EventTeamMembers.js';

addFilter(
	'fairEvents.manageEvent.detailsSections',
	'fair-events-experimental/team-members-section',
	( sections, { eventDateId, eventDate } ) => [
		...sections,
		{
			name: SECTION_NAME,
			render: () => (
				<EventTeamMembers
					key={ eventDateId }
					eventDateId={ eventDateId }
					isSeries={ 'master' === eventDate?.occurrence_type }
				/>
			),
		},
	]
);
