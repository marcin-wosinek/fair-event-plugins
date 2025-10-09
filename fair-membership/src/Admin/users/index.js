/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { render } from '@wordpress/element';

/**
 * Internal dependencies
 */
import UsersApp from './UsersApp.js';

// Render the app when DOM is ready
domReady(() => {
	const rootElement = document.getElementById('fair-membership-users-root');
	if (rootElement) {
		render(<UsersApp />, rootElement);
	}
});
