import { createRoot } from '@wordpress/element';
import GroupMembersPage from './GroupMembersPage.js';

// Defensive: handle both scenarios (DOM loading or already loaded)
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', initializeGroupMembersPage);
} else {
	initializeGroupMembersPage();
}

function initializeGroupMembersPage() {
	const rootElement = document.getElementById(
		'fair-membership-group-members-root'
	);
	if (!rootElement) {
		return;
	}

	// Get group ID from dataset
	const groupId = parseInt(rootElement.dataset.groupId, 10);

	if (!groupId) {
		console.error('Group ID not provided');
		return;
	}

	const root = createRoot(rootElement);
	root.render(<GroupMembersPage groupId={groupId} />);
}
