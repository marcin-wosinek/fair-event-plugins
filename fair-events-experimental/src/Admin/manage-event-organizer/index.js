/**
 * Manage Event Organizer tab - Entry Point
 *
 * Registers the Organizer tab with the fair-events Manage Event page via a
 * filter (#2305). PHP enqueues this script only for administrators while
 * organizers are available, so the tab is absent otherwise.
 *
 * @package FairEventsExperimental
 */

import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import EventOrganizer, { TAB_NAME } from './EventOrganizer.js';

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-events-experimental/organizer-tab',
	( tabs, { eventDateId, setTabDirty, getTabDraft, setTabDraft } ) => [
		...tabs,
		{
			name: TAB_NAME,
			title: __( 'Organizer', 'fair-events-experimental' ),
			// Right after Messages.
			order: 35,
			isVisible: true,
			render: () => (
				<EventOrganizer
					eventDateId={ eventDateId }
					setTabDirty={ setTabDirty }
					getTabDraft={ getTabDraft }
					setTabDraft={ setTabDraft }
				/>
			),
		},
	]
);
