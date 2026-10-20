/**
 * Manage Event Schedule tab - Entry Point
 *
 * Registers the Schedule tab with the fair-events Manage Event page via a
 * filter. It loads independently of the optional feature bundles.
 *
 * @package FairEventsExperimental
 */

import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import { isLinkOnlyEvent } from 'fair-events-shared/src/event-utils.js';
import EventSchedule from './EventSchedule.js';
import './schedule.css';

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-events-experimental/schedule-tab',
	(
		tabs,
		{
			eventDate,
			eventDateId,
			enabledFeatures = {},
			scheduleEnabled,
			setTabDirty,
			getTabDraft,
			setTabDraft,
		}
	) => [
		...tabs,
		{
			name: 'schedule',
			title: __( 'Schedule', 'fair-events-experimental' ),
			// Right after Prices, where the workshops are created.
			order: 22,
			// Absent until the organizer enables it in Prices. An older
			// fair-events never sets scheduleEnabled, so the tab stays out.
			// `ticketing` is core's base ticketing; the Experimental
			// `ticketingExtensions` setting does not affect the schedule.
			isVisible: !! enabledFeatures.ticketing && !! scheduleEnabled,
			// Same restrictions as Prices: a series is edited on the series,
			// and a link-only event has nothing to book.
			disabled:
				eventDate?.occurrence_type === 'generated' ||
				isLinkOnlyEvent( eventDate ),
			render: () => (
				<EventSchedule
					eventDateId={ eventDateId }
					eventDate={ eventDate }
					setTabDirty={ setTabDirty }
					getTabDraft={ getTabDraft }
					setTabDraft={ setTabDraft }
				/>
			),
		},
	]
);
