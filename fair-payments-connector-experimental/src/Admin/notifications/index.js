/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import NotificationsApp from './NotificationsApp.js';

domReady(() => {
	const root = document.getElementById(
		'fair-payments-connector-experimental-notifications-root'
	);
	if (root) {
		createRoot(root).render(<NotificationsApp />);
	}
});
