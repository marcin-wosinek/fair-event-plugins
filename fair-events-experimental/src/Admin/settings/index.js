/**
 * Settings tab extension - Entry Point
 *
 * Registers the Experimental tab with the fair-events Settings page via the
 * `fairEvents.settings.tabs` filter. Enqueued as a dependant of the host
 * bundle, so the filter is in place before the host app mounts.
 *
 * @package FairEventsExperimental
 */

/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { addFilter } from '@wordpress/hooks';

/**
 * Internal dependencies
 */
import ExperimentalTab from './ExperimentalTab.js';

addFilter(
	'fairEvents.settings.tabs',
	'fair-events-experimental/experimental-tab',
	( tabs ) => [
		...tabs,
		{
			name: 'experimental',
			title: __( 'Experimental', 'fair-events-experimental' ),
			order: 100,
			render: ( { onNotice } ) => (
				<ExperimentalTab onNotice={ onNotice } />
			),
		},
	]
);
