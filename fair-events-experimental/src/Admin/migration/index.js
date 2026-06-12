/**
 * Migration Page Entry Point
 *
 * @package FairEvents
 */

import { createRoot } from '@wordpress/element';
import domReady from '@wordpress/dom-ready';
import MigrationApp from './MigrationApp.js';

domReady(() => {
	const root = document.getElementById('fair-events-migration-root');
	if (root) {
		createRoot(root).render(<MigrationApp />);
	}
});
