/**
 * WordPress dependencies
 */
import { createRoot } from '@wordpress/element';
import domReady from '@wordpress/dom-ready';

/**
 * Internal dependencies
 */
import SettingsApp from './SettingsApp.js';

/**
 * Initialize the Settings page
 */
domReady(() => {
	const root = document.getElementById('fair-events-settings-root');
	if (root) {
		createRoot(root).render(<SettingsApp />);
	}
});
