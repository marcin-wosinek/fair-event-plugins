/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import ReconciliationApp from './ReconciliationApp.js';

/**
 * Initialize the reconciliation page
 */
domReady(() => {
	const root = document.getElementById('fair-payment-reconciliation-root');
	if (root) {
		createRoot(root).render(<ReconciliationApp />);
	}
});
