/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import ImageTemplates from './ImageTemplates.js';

/**
 * Initialize the Image Templates page
 */
domReady(() => {
	const container = document.getElementById(
		'fair-audience-image-templates-root'
	);
	if (container) {
		const root = createRoot(container);
		root.render(<ImageTemplates />);
	}
});
