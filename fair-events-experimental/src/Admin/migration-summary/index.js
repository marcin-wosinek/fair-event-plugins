import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import MigrationSummaryApp from './MigrationSummaryApp.js';

domReady(() => {
	const rootElement = document.getElementById(
		'fair-events-migration-summary-root'
	);
	if (rootElement) {
		const root = createRoot(rootElement);
		root.render(<MigrationSummaryApp />);
	}
});
