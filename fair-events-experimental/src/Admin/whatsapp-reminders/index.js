/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Shared dependencies
 *
 * Another entry of this plugin imports the same stylesheet; the query gives
 * this page its own copy in its own style-index.css.
 */
import 'fair-events-shared/src/admin-table/style.css?whatsapp-reminders';

/**
 * Internal dependencies
 */
import RemindersPage from './RemindersPage.js';
import './style.css';

domReady( () => {
	const rootElement = document.getElementById(
		'fair-events-whatsapp-reminders-root'
	);
	if ( rootElement ) {
		const data = window.fairEventsWhatsAppRemindersData || {};
		createRoot( rootElement ).render(
			<RemindersPage
				notificationsUrl={ data.notificationsUrl }
				teamMembersUrl={ data.teamMembersUrl || null }
				sourcesUrl={ data.sourcesUrl || null }
			/>
		);
	}
} );
