/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import SettingsApp from './SettingsApp.js';

/**
 * Initialize the settings page
 */
domReady(() => {
	const root = document.getElementById(
		'fair-payments-connector-settings-root'
	);
	if (root) {
		createRoot(root).render(<SettingsApp />);
	}
});
