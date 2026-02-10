/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import WeeklySchedule from './WeeklySchedule.js';

/**
 * Initialize the weekly schedule page
 */
domReady(() => {
	const container = document.getElementById(
		'fair-audience-weekly-schedule-root'
	);
	if (container) {
		const root = createRoot(container);
		root.render(<WeeklySchedule />);
	}
});
