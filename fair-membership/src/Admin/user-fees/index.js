import { createRoot } from '@wordpress/element';
import UserFeesPage from './UserFeesPage.js';

// Defensive: handle both scenarios (DOM loading or already loaded)
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeUserFeesPage);
} else {
	initializeUserFeesPage();
}

function initializeUserFeesPage() {
	const rootElement = document.getElementById(
		'fair-membership-user-fees-root'
	);
	if (!rootElement) {
		return;
	}

	const root = createRoot(rootElement);
	root.render(<UserFeesPage />);
}
