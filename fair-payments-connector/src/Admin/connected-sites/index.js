/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import ConnectedSitesApp from './ConnectedSitesApp.js';

/**
 * Initialize the connected sites page
 */
domReady(() => {
	const root = document.getElementById('fair-payments-connector-connected-sites-root');
	if (root) {
		createRoot(root).render(<ConnectedSitesApp />);
	}
});
