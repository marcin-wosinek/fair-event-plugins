/**
 * Connections Admin Page Entry Point
 */
import { createRoot } from '@wordpress/element';
import ConnectionsPage from './ConnectionsPage.js';

document.addEventListener('DOMContentLoaded', () => {
	const rootElement = document.getElementById(
		'fair-platform-connections-root'
	);

	if (rootElement) {
		const root = createRoot(rootElement);
		root.render(<ConnectionsPage />);
	}
});
