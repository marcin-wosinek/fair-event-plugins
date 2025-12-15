import { createRoot } from '@wordpress/element';
import GroupsPage from './GroupsPage.js';

// Defensive: handle both scenarios (DOM loading or already loaded)
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeGroupsPage);
} else {
	initializeGroupsPage();
}

function initializeGroupsPage() {
	const rootElement = document.getElementById('fair-membership-groups-root');
	if (!rootElement) {
		return;
	}

	const root = createRoot(rootElement);
	root.render(<GroupsPage />);
}
