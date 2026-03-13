/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import TransactionPage from './TransactionPage.js';

/**
 * Initialize the transaction detail page
 */
domReady(() => {
	const root = document.getElementById('fair-payment-transaction-root');
	if (root) {
		createRoot(root).render(<TransactionPage />);
	}
});
