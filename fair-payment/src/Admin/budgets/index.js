/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import BudgetsApp from './BudgetsApp.js';

/**
 * Initialize the budgets page
 */
domReady(() => {
	const root = document.getElementById('fair-payment-budgets-root');
	if (root) {
		createRoot(root).render(<BudgetsApp />);
	}
});
