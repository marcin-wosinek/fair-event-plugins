import { createRoot } from '@wordpress/element';
import GroupFeesPage from './GroupFeesPage.js';

// Defensive: handle both scenarios (DOM loading or already loaded)
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeGroupFeesPage);
} else {
	initializeGroupFeesPage();
}

function initializeGroupFeesPage() {
	const rootElement = document.getElementById(
		'fair-membership-group-fees-root'
	);
	if (!rootElement) {
		return;
	}

	const root = createRoot(rootElement);
	root.render(<GroupFeesPage />);
}
