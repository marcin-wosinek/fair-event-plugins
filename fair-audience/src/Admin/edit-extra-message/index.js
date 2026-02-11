import { createRoot } from '@wordpress/element';
import EditExtraMessage from './EditExtraMessage.js';

const root = document.getElementById('fair-audience-edit-extra-message-root');

if (root) {
	createRoot(root).render(<EditExtraMessage />);
}
