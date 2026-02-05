/**
 * Manage Event Page - Entry Point
 *
 * @package FairEvents
 */

import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import ManageEventApp from './ManageEventApp.js';

domReady(() => {
	const container = document.getElementById('fair-events-manage-event-root');
	if (container) {
		const root = createRoot(container);
		root.render(<ManageEventApp />);
	}
});
