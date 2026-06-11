/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import FeeDashboardApp from './FeeDashboardApp.js';

domReady(() => {
	const root = document.getElementById(
		'fair-payments-connector-fee-dashboard-root'
	);
	if (root) {
		createRoot(root).render(<FeeDashboardApp />);
	}
});
