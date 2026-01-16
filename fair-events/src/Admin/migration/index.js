/**
 * Migration Page Entry Point
 *
 * @package FairEvents
 */

import { render } from '@wordpress/element';
import domReady from '@wordpress/dom-ready';
import MigrationApp from './MigrationApp.js';

domReady(() => {
	const root = document.getElementById('fair-events-migration-root');
	if (root) {
		render(<MigrationApp />, root);
	}
});
