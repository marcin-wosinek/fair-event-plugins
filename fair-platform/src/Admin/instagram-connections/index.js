/**
 * Instagram Connections Admin Page Entry Point
 */
import { createRoot } from '@wordpress/element';
import InstagramConnectionsPage from './InstagramConnectionsPage.js';

function initializeApp() {
	const rootElement = document.getElementById(
		'fair-platform-instagram-connections-root'
	);

	if ( rootElement ) {
		createRoot( rootElement ).render( <InstagramConnectionsPage /> );
	}
}

if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', initializeApp );
} else {
	initializeApp();
}
