/**
 * Team members admin page - Entry Point
 *
 * @package FairEventsExperimental
 */

/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Shared dependencies
 */
import 'fair-events-shared/src/admin-table/style.css?team-members';

/**
 * Internal dependencies
 */
import './style.css';
import TeamMembersPage from './TeamMembersPage.js';

domReady( () => {
	const rootElement = document.getElementById(
		'fair-events-team-members-root'
	);
	if ( rootElement ) {
		createRoot( rootElement ).render( <TeamMembersPage /> );
	}
} );
