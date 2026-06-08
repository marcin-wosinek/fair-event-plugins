/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import ApiTokensApp from './ApiTokensApp.js';

/**
 * Initialize the API tokens page
 */
domReady(() => {
	const root = document.getElementById(
		'fair-payments-connector-api-tokens-root'
	);
	if (root) {
		createRoot(root).render(<ApiTokensApp />);
	}
});
