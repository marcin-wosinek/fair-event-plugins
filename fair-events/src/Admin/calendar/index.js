/**
 * Admin Calendar Page Entry Point
 *
 * @package FairEvents
 */

import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import CalendarApp from './CalendarApp.js';
import './style.css';

domReady(() => {
	const container = document.getElementById('fair-events-calendar-root');
	if (container) {
		const root = createRoot(container);
		root.render(<CalendarApp />);
	}
});
