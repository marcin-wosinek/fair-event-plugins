/**
 * Manage Event Audience tab - Entry Point
 *
 * Registers fair-audience's Audience tab with the fair-events manage-event
 * tab registry via a filter, instead of fair-events hardcoding it.
 *
 * @package FairAudience
 */

import { __ } from '@wordpress/i18n';
import { decodeEntityText } from 'fair-events-shared/src/event-utils.js';
import { addFilter } from '@wordpress/hooks';
import { isLinkOnlyEvent } from 'fair-events-shared';
import EventAudience from './EventAudience.js';
import './style.css';

const { audienceUrl = '' } = window.fairEventsManageEventData || {};

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-audience/audience-tab',
	( tabs, { eventDate, eventDateId, eventTitle, enabledFeatures = {} } ) => {
		if ( ! audienceUrl ) {
			return tabs;
		}

		return [
			...tabs,
			{
				name: 'audience',
				title: __( 'Audience', 'fair-audience' ),
				order: 50,
				isVisible: true,
				disabled: isLinkOnlyEvent( eventDate ),
				// Manage Event passes its editable title with entities; decode
				// it once here, so the tab's dialogs show text (#2300).
				render: () => (
					<EventAudience
						eventId={ eventDate.event_id }
						eventDateId={ eventDateId }
						audienceUrl={ audienceUrl }
						eventTitle={ decodeEntityText( eventTitle ) }
						groupRulesAvailable={
							!! enabledFeatures.groupRulesAvailable
						}
					/>
				),
			},
		];
	}
);
