import { createRoot } from '@wordpress/element';
import FeesList from './FeesList.js';

const rootElement = document.getElementById('fair-audience-fees-list-root');
if (rootElement) {
	createRoot(rootElement).render(<FeesList />);
}
