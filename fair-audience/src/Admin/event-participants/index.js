import { createRoot } from '@wordpress/element';
import EventParticipants from './EventParticipants.js';

const rootElement = document.getElementById(
	'fair-audience-event-participants-root'
);
if (rootElement) {
	createRoot(rootElement).render(<EventParticipants />);
}
