/**
 * Manage Event Audience tab - Entry Point
 *
 * Registers fair-audience's Audience tab with the fair-events manage-event
 * tab registry via a filter, instead of fair-events hardcoding it.
 *
 * @package FairAudience
 */

import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import { isLinkOnlyEvent } from 'fair-events-shared';
import EventAudience from './EventAudience.js';

const { audienceUrl = '' } = window.fairEventsManageEventData || {};

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-audience/audience-tab',
	(tabs, { eventDate, eventDateId, eventTitle }) => {
		if (!audienceUrl) {
			return tabs;
		}

		return [
			...tabs,
			{
				name: 'audience',
				title: __('Audience', 'fair-audience'),
				order: 50,
				isVisible: true,
				disabled: isLinkOnlyEvent(eventDate),
				render: () => (
					<EventAudience
						eventId={eventDate.event_id}
						eventDateId={eventDateId}
						audienceUrl={audienceUrl}
						eventTitle={eventTitle}
					/>
				),
			},
		];
	}
);
