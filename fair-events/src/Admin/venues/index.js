/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import VenuesApp from './VenuesApp.js';

// Render the app when DOM is ready
domReady(() => {
	const rootElement = document.getElementById('fair-events-venues-root');
	if (rootElement) {
		const root = createRoot(rootElement);
		root.render(<VenuesApp />);
	}
});
