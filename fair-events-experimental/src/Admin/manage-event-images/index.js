/**
 * Manage Event Images tab - Entry Point
 *
 * Registers the Images tab with the fair-events Manage Event page. Loaded
 * only while the `event-images` bundle is on.
 *
 * @package FairEventsExperimental
 */

import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import EventImages, { TAB_NAME } from './EventImages.js';
import './images.css';

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-events-experimental/images-tab',
	( tabs, { eventDateId, setTabDirty, getTabDraft, setTabDraft } ) => [
		...tabs,
		{
			name: TAB_NAME,
			title: __( 'Images', 'fair-events-experimental' ),
			// After Event Details and the programme tabs.
			order: 24,
			// A generated occurrence shows its series' images read-only.
			isVisible: true,
			render: () => (
				<EventImages
					eventDateId={ eventDateId }
					setTabDirty={ setTabDirty }
					getTabDraft={ getTabDraft }
					setTabDraft={ setTabDraft }
				/>
			),
		},
	]
);
