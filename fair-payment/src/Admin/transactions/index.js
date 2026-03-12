/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import TransactionsApp from './TransactionsApp.js';

/**
 * Initialize the transactions page
 */
domReady(() => {
	const root = document.getElementById('fair-payment-transactions-root');
	if (root) {
		createRoot(root).render(<TransactionsApp />);
	}
});
