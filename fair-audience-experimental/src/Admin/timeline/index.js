/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import Timeline from './Timeline.js';

/**
 * Initialize the Timeline page
 */
domReady(() => {
	const container = document.getElementById('fair-audience-timeline-root');
	if (container) {
		const root = createRoot(container);
		root.render(<Timeline />);
	}
});
