import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import AllEvents from './AllEvents.js';

domReady(() => {
	const container = document.getElementById('fair-events-all-events-root');
	if (container) {
		const root = createRoot(container);
		root.render(<AllEvents />);
	}
});
