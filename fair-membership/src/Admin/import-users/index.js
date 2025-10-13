/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { render } from '@wordpress/element';

/**
 * Internal dependencies
 */
import ImportUsers from './ImportUsers.js';

// Render the app when DOM is ready
domReady(() => {
	const rootElement = document.getElementById(
		'fair-membership-import-users-root'
	);
	if (rootElement) {
		render(<ImportUsers />, rootElement);
	}
});
