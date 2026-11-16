/**
 * Settings tab extension - Entry Point
 *
 * Registers the Experimental tab with the fair-events Settings page via the
 * `fairEvents.settings.tabs` filter and, while the `organizers` bundle is on,
 * turns the Organizer tab into the Organizers manager (keeping its
 * `tab=organizer` URL). Enqueued as a dependant of the host
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
import OrganizersTab from './organizers/OrganizersTab.js';
import 'fair-events-shared/src/admin-table/style.css?settings';

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
	( tabs ) => {
		if ( ! window.fairEventsExperimentalSettingsData?.organizersEnabled ) {
			return tabs;
		}

		return tabs.map( ( tab ) =>
			'organizer' === tab.name
				? {
						...tab,
						title: __( 'Organizers', 'fair-events-experimental' ),
						render: () => <OrganizersTab />,
					}
				: tab
		);
	}
);
