/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

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
