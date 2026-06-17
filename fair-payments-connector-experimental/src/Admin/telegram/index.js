/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import TelegramApp from './TelegramApp.js';

/**
 * Initialize the Telegram settings page
 */
domReady(() => {
	const root = document.getElementById(
		'fair-payments-connector-experimental-telegram-root'
	);
	if (root) {
		createRoot(root).render(<TelegramApp />);
	}
});
