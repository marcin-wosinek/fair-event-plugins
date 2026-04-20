/**
 * Manage Invitations Page - Entry Point
 *
 * @package FairEvents
 */

import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import ManageInvitations from './ManageInvitations.js';

domReady(() => {
	const container = document.getElementById(
		'fair-events-manage-invitations-root'
	);
	if (container) {
		const root = createRoot(container);
		root.render(<ManageInvitations />);
	}
});
