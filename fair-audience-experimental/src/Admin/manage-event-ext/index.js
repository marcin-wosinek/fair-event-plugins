/**
 * Manage Event tab extensions - Entry Point
 *
 * Registers fair-audience's Groups and Mailings tabs with the fair-events
 * manage-event tab registry via a filter, instead of fair-events hardcoding
 * them. The Audience tab lives in core fair-audience
 * (`fair-audience/src/Admin/manage-event-audience-tab/`).
 *
 * @package FairAudience
 */

import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import { isLinkOnlyEvent } from 'fair-events-shared';
import GroupRules from './GroupRules.js';
import EventMailings from './EventMailings.js';

const { audienceUrl = '' } = window.fairEventsManageEventData || {};

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-audience-experimental/groups-tab',
	(tabs, { eventDate, eventDateId, enabledFeatures = {} }) => {
		if (!audienceUrl || !enabledFeatures.ticketing) {
			return tabs;
		}

		return [
			...tabs,
			{
				name: 'groups',
				title: __('Groups', 'fair-audience-experimental'),
				order: 30,
				isVisible: true,
				disabled:
					eventDate?.occurrence_type === 'generated' ||
					isLinkOnlyEvent(eventDate),
				render: () => <GroupRules eventDateId={eventDateId} />,
			},
		];
	}
);

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-audience-experimental/mailings-tab',
	(tabs, { eventDate, eventDateId, enabledFeatures = {} }) => {
		if (!audienceUrl || !enabledFeatures.mailings) {
			return tabs;
		}

		return [
			...tabs,
			{
				name: 'mailings',
				title: __('Mailings', 'fair-audience-experimental'),
				order: 55,
				isVisible: true,
				disabled: isLinkOnlyEvent(eventDate),
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
