/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import EntriesApp from './EntriesApp.js';

/**
 * Initialize the entries page
 */
domReady(() => {
	const root = document.getElementById(
		'fair-payments-connector-entries-root'
	);
	if (root) {
		createRoot(root).render(<EntriesApp />);
	}
});
