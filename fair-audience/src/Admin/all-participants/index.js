import { createRoot } from '@wordpress/element';
import AllParticipants from './AllParticipants.js';

const rootElement = document.getElementById(
	'fair-audience-all-participants-root'
);
if (rootElement) {
	createRoot(rootElement).render(<AllParticipants />);
}
