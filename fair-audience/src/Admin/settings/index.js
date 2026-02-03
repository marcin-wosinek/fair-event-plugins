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
	const container = document.getElementById('fair-audience-settings-root');
	if (container) {
		const root = createRoot(container);
		root.render(<SettingsApp />);
	}
});
