/**
 * WordPress dependencies
 */
import { createRoot } from '@wordpress/element';
import domReady from '@wordpress/dom-ready';

/**
 * Internal dependencies
 */
import SettingsApp from './SettingsApp.js';

domReady(() => {
	const root = document.getElementById(
		'fair-audience-experimental-settings-root'
	);
	if (root) {
		createRoot(root).render(<SettingsApp />);
	}
});
