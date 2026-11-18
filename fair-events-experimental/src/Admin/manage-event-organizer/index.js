/**
 * Manage Event organizer section - Entry Point
 *
 * Adds the organizer to the fair-events Manage Event page's Event Details,
 * above Categories, via a filter (#2305). PHP enqueues this script only for
 * administrators while organizers are available, so the section is absent
 * otherwise.
 *
 * @package FairEventsExperimental
 */

import { addFilter } from '@wordpress/hooks';
import EventOrganizer, { SECTION_NAME } from './EventOrganizer.js';

addFilter(
	'fairEvents.manageEvent.detailsSections',
	'fair-events-experimental/organizer-section',
	( sections, { eventDateId, setTabDirty, getTabDraft, setTabDraft } ) => [
		...sections,
		{
			name: SECTION_NAME,
			render: () => (
				<EventOrganizer
					key={ eventDateId }
					eventDateId={ eventDateId }
					setTabDirty={ setTabDirty }
					getTabDraft={ getTabDraft }
					setTabDraft={ setTabDraft }
				/>
			),
		},
	]
);
