/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { render } from '@wordpress/element';

/**
 * Internal dependencies
 */
import AttendanceConfirmation from './AttendanceConfirmation.js';

// Render the app when DOM is ready
domReady(() => {
	const rootElement = document.getElementById('fair-rsvp-attendance-root');
	if (rootElement) {
		const eventId = parseInt(rootElement.dataset.eventId, 10);
		render(<AttendanceConfirmation eventId={eventId} />, rootElement);
	}
});
