import { createRoot } from '@wordpress/element';
import EventsList from './EventsList.js';

const rootElement = document.getElementById('fair-audience-events-list-root');
if (rootElement) {
	createRoot(rootElement).render(<EventsList />);
}
