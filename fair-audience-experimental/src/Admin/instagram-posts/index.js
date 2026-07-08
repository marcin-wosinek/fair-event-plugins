/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import InstagramPosts from './InstagramPosts.js';

/**
 * Initialize the Instagram Posts page
 */
domReady(() => {
	const container = document.getElementById(
		'fair-audience-instagram-posts-root'
	);
	if (container) {
		const root = createRoot(container);
		root.render(<InstagramPosts />);
	}
});
