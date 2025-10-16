/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { render } from '@wordpress/element';

/**
 * Internal dependencies
 */
import EventsList from './EventsList.js';

// Render the app when DOM is ready
domReady(() => {
	const rootElement = document.getElementById('fair-rsvp-events-root');
	if (rootElement) {
		render(<EventsList />, rootElement);
	}
});
