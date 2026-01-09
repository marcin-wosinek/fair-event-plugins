import { render } from '@wordpress/element';
import EventParticipants from './EventParticipants.js';

const rootElement = document.getElementById(
	'fair-audience-event-participants-root'
);
if (rootElement) {
	render(<EventParticipants />, rootElement);
}
