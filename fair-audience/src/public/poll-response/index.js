import { createRoot } from '@wordpress/element';
import PollResponse from './PollResponse.js';

// Defensive DOM ready pattern
function init() {
	const root = document.getElementById('fair-audience-poll-root');

	if (root) {
		createRoot(root).render(<PollResponse />);
	}
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', init);
} else {
	init();
}
