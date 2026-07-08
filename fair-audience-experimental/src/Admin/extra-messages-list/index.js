import { createRoot } from '@wordpress/element';
import ExtraMessagesList from './ExtraMessagesList.js';

const root = document.getElementById('fair-audience-extra-messages-root');

if (root) {
	createRoot(root).render(<ExtraMessagesList />);
}
