/**
 * Manage Event tab extensions - Entry Point
 *
 * Registers fair-audience's Mailings tab with the fair-events manage-event
 * tab registry via a filter, instead of fair-events hardcoding it.
 *
 * @package FairAudience
 */

import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import EventMailings from './EventMailings.js';

const { audienceUrl = '' } = window.fairEventsManageEventData || {};

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
