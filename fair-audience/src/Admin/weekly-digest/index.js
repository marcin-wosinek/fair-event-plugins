/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import WeeklyDigest from './WeeklyDigest.js';

/**
 * Initialize the weekly digest page
 */
domReady(() => {
	const container = document.getElementById(
		'fair-audience-weekly-digest-root'
	);
	if (container) {
		const root = createRoot(container);
		root.render(<WeeklyDigest />);
	}
});
