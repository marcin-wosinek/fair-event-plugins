/**
 * Manage Event tab extensions - Entry Point
 *
 * Registers fair-audience's Audience, Groups, and Mailings tabs with the
 * fair-events manage-event tab registry via a filter, instead of fair-events
 * hardcoding them.
 *
 * @package FairAudience
 */

import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import EventAudience from './EventAudience.js';
import GroupRules from './GroupRules.js';
import EventMailings from './EventMailings.js';

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

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-audience/groups-tab',
	(tabs, { eventDate, eventDateId, enabledFeatures = {} }) => {
		if (!audienceUrl || !enabledFeatures.ticketing) {
			return tabs;
		}

		return [
			...tabs,
			{
				name: 'groups',
				title: __('Groups', 'fair-audience'),
				order: 30,
				isVisible: true,
				disabled: eventDate?.occurrence_type === 'generated',
				render: () => <GroupRules eventDateId={eventDateId} />,
			},
		];
	}
);

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-audience/mailings-tab',
	(tabs, { eventDate, eventDateId, enabledFeatures = {} }) => {
		if (!audienceUrl || !enabledFeatures.mailings) {
			return tabs;
		}

		return [
			...tabs,
			{
				name: 'mailings',
				title: __('Mailings', 'fair-audience'),
				order: 55,
				isVisible: true,
				render: () => (
					<EventMailings
						eventDateId={eventDateId}
						startDatetime={eventDate.start_datetime}
						endDatetime={eventDate.end_datetime}
						allDay={eventDate.all_day}
					/>
				),
			},
		];
	}
);
