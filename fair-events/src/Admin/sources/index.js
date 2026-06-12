/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import SourcesList from './SourcesList.js';

// Render the app when DOM is ready
domReady(() => {
	const rootElement = document.getElementById('fair-events-sources-root');
	if (rootElement) {
		createRoot(rootElement).render(<SourcesList />);
	}
});
