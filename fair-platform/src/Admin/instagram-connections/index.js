/**
 * Instagram Connections Admin Page Entry Point
 */
import { createRoot } from '@wordpress/element';
import InstagramConnectionsPage from './InstagramConnectionsPage.js';

document.addEventListener('DOMContentLoaded', () => {
	const rootElement = document.getElementById(
		'fair-platform-instagram-connections-root'
	);

	if (rootElement) {
		const root = createRoot(rootElement);
		root.render(<InstagramConnectionsPage />);
	}
});
