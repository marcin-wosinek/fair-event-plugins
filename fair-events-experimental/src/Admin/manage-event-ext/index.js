/**
 * Manage Event tab extensions - Entry Point
 *
 * Registers this plugin's manage-event tabs (Statistics) and admin-tab
 * actions (Duplicate/Merge) with the fair-events tab registry via filters,
 * instead of fair-events hardcoding them.
 *
 * @package FairEventsExperimental
 */

import { Button, __experimentalVStack as VStack } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import { isLinkOnlyEvent } from 'fair-events-shared';
import EventStatistics from '../event-statistics/EventStatistics.js';

const {
	statisticsUrl = '',
	duplicateEventUrl = '',
	mergeEventUrl = '',
} = window.fairEventsManageEventData || {};

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-events-experimental/statistics-tab',
	(tabs, { eventDate } = {}) => {
		if (!statisticsUrl) {
			return tabs;
		}

		return [
			...tabs,
			{
				name: 'statistics',
				title: __('Statistics', 'fair-events-experimental'),
				order: 60,
				isVisible: true,
				disabled: isLinkOnlyEvent(eventDate),
				render: ({ eventDateId }) => (
					<EventStatistics eventDateId={eventDateId} />
				),
			},
		];
	}
);

addFilter(
	'fairEvents.manageEvent.adminActions',
	'fair-events-experimental/duplicate-merge-actions',
	(actions, { eventDateId }) => {
		const extraActions = [];

		if (duplicateEventUrl) {
			extraActions.push(
				<VStack spacing={2} key="duplicate-event">
					<p style={{ color: '#666' }}>
						{__(
							'Create a copy of this event with the same details, links, and settings.',
							'fair-events-experimental'
						)}
					</p>
					<div>
						<Button
							variant="secondary"
							href={`${duplicateEventUrl}${eventDateId}`}
						>
							{__('Duplicate Event', 'fair-events-experimental')}
						</Button>
					</div>
				</VStack>
			);
		}

		if (mergeEventUrl) {
			extraActions.push(
				<VStack spacing={2} key="merge-event">
					<p style={{ color: '#666' }}>
						{__(
							'Merge this event into another event date, moving or cleaning up all linked data.',
							'fair-events-experimental'
						)}
					</p>
					<div>
						<Button
							variant="secondary"
							href={`${mergeEventUrl}${eventDateId}`}
						>
							{__('Merge Event', 'fair-events-experimental')}
						</Button>
					</div>
				</VStack>
			);
		}

		return [...actions, ...extraActions];
	}
);
