import { createRoot } from '@wordpress/element';
import AttendanceCheck from './AttendanceCheck.js';

// Defensive: handle both scenarios (DOM loading or already loaded).
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeAttendanceCheck);
} else {
	initializeAttendanceCheck();
}

function initializeAttendanceCheck() {
	const rootElement = document.getElementById(
		'fair-rsvp-attendance-check-root'
	);

	if (!rootElement) {
		return;
	}

	const eventId = parseInt(rootElement.dataset.eventId, 10);

	if (!eventId) {
		console.error('Event ID not found in root element');
		return;
	}

	const root = createRoot(rootElement);
	root.render(<AttendanceCheck eventId={eventId} />);
}
