/**
 * Settings tab extension - Entry Point
 *
 * Registers the Experimental tab with the fair-events Settings page via the
 * `fairEvents.settings.tabs` filter and, while the `organizers` bundle is on,
 * removes the Organizer tab: the Fair Events → Organizers page manages every
 * organizer then, and the server redirects the old `tab=organizer` URL
 * there. Enqueued as a dependant of the host
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

addFilter(
	'fairEvents.settings.tabs',
	'fair-events-experimental/organizers-tab',
	( tabs ) =>
		window.fairEventsExperimentalSettingsData?.organizersEnabled
			? tabs.filter( ( tab ) => 'organizer' !== tab.name )
			: tabs
);
