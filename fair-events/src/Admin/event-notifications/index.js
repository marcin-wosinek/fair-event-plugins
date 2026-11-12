/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Shared dependencies
 *
 * Manage Event imports the same stylesheet. wp-scripts emits a stylesheet
 * shared by two entries into the first entry's style-index.css only, so
 * the query makes this page's copy its own module, built into its own
 * style-index.css.
 */
import 'fair-events-shared/src/admin-table/style.css?event-notifications';

/**
 * Internal dependencies
 */
import EventNotifications from './EventNotifications.js';
import './style.css';

domReady( () => {
	const rootElement = document.getElementById(
		'fair-events-event-notifications-root'
	);
	if ( rootElement ) {
		createRoot( rootElement ).render(
			<EventNotifications
				sourcesUrl={
					window.fairEventsEventNotificationsData?.sourcesUrl || null
				}
			/>
		);
	}
} );
