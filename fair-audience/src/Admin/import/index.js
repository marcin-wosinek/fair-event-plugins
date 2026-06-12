import { createRoot } from '@wordpress/element';
import Import from './Import.js';

const rootElement = document.getElementById('fair-audience-import-root');
if (rootElement) {
	createRoot(rootElement).render(<Import />);
}
