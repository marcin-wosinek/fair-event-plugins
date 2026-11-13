/**
 * Connections Admin Page Entry Point
 */
import { createRoot } from '@wordpress/element';
import ConnectionsPage from './ConnectionsPage.js';

function initializeApp() {
	const rootElement = document.getElementById(
		'fair-platform-connections-root'
	);

	if ( rootElement ) {
		createRoot( rootElement ).render( <ConnectionsPage /> );
	}
}

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', initializeApp );
} else {
	initializeApp();
}
