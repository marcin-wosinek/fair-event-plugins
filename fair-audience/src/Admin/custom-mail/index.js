/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import CustomMail from './CustomMail.js';

/**
 * Initialize the Custom Mail page
 */
domReady(() => {
	const container = document.getElementById('fair-audience-custom-mail-root');
	if (container) {
		const root = createRoot(container);
		root.render(<CustomMail />);
	}
});
