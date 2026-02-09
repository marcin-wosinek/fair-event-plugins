/**
 * Admin Source View Page Entry Point
 *
 * @package FairEvents
 */

import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import SourceViewApp from './SourceViewApp.js';

domReady(() => {
	const container = document.getElementById('fair-events-source-view-root');
	if (container) {
		const root = createRoot(container);
		root.render(<SourceViewApp />);
	}
});
