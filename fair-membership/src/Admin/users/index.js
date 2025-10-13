/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { render } from '@wordpress/element';

/**
 * Internal dependencies
 */
import MembershipMatrix from './MembershipMatrix.js';

// Render the app when DOM is ready
domReady(() => {
	const rootElement = document.getElementById('fair-membership-matrix-root');
	if (rootElement) {
		render(<MembershipMatrix />, rootElement);
	}
});
