/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { render } from '@wordpress/element';

/**
 * Internal dependencies
 */
import InvitationsList from './InvitationsList.js';

// Render the app when DOM is ready
domReady(() => {
	const rootElement = document.getElementById('fair-rsvp-invitations-root');
	if (rootElement) {
		render(<InvitationsList />, rootElement);
	}
});
