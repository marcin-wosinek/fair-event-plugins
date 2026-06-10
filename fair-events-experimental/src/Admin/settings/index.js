/**
 * WordPress dependencies
 */
import { render } from '@wordpress/element';
import domReady from '@wordpress/dom-ready';

/**
 * Internal dependencies
 */
import SettingsApp from './SettingsApp.js';

domReady(() => {
	const root = document.getElementById(
		'fair-events-experimental-settings-root'
	);
	if (root) {
		render(<SettingsApp />, root);
	}
});
