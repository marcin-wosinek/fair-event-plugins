/**
 * Manage Event Marketing tab - Entry Point
 *
 * Registers the Marketing tab with the fair-events Manage Event page. Loaded
 * only while the `marketing-assets` bundle is on, for administrators.
 *
 * @package FairEventsExperimental
 */

import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';
import MarketingAssets, { TAB_NAME } from './MarketingAssets.js';
import './marketing-assets.css';

addFilter(
	'fairEvents.manageEvent.tabs',
	'fair-events-experimental/marketing-assets-tab',
	( tabs, { eventDateId, setTabDirty, getTabDraft, setTabDraft } ) => [
		...tabs,
		{
			name: TAB_NAME,
			title: __( 'Marketing', 'fair-events-experimental' ),
			// After Images.
			order: 25,
			// Every date has its own assets, generated occurrences included.
			isVisible: true,
			render: () => (
				<MarketingAssets
					eventDateId={ eventDateId }
					setTabDirty={ setTabDirty }
					getTabDraft={ getTabDraft }
					setTabDraft={ setTabDraft }
				/>
			),
		},
	]
);
