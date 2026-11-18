/**
 * Organizers admin page - Entry Point
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
import 'fair-events-shared/src/admin-table/style.css?organizers';

/**
 * Internal dependencies
 */
import OrganizersPage from './OrganizersPage.js';

domReady( () => {
	const rootElement = document.getElementById(
		'fair-events-organizers-root'
	);
	if ( rootElement ) {
		createRoot( rootElement ).render( <OrganizersPage /> );
	}
} );
