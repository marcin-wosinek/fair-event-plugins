import { createRoot } from '@wordpress/element';
import EditPoll from './EditPoll.js';

const root = document.getElementById('fair-audience-edit-poll-root');

if (root) {
	createRoot(root).render(<EditPoll />);
}
