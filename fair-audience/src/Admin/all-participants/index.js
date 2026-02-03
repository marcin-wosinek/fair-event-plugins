import { render } from '@wordpress/element';
import AllParticipants from './AllParticipants.js';

const rootElement = document.getElementById(
	'fair-audience-all-participants-root'
);
if (rootElement) {
	render(<AllParticipants />, rootElement);
}
