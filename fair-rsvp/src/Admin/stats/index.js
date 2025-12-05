/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { render } from '@wordpress/element';

/**
 * Internal dependencies
 */
import InvitationStats from './InvitationStats.js';

// Render the app when DOM is ready
domReady(() => {
	const rootElement = document.getElementById('fair-rsvp-stats-root');
	if (rootElement) {
		render(<InvitationStats />, rootElement);
	}
});
