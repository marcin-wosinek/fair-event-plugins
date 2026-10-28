/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import WhatsAppPage from './WhatsAppPage.js';

// Render the app when DOM is ready
domReady( () => {
	const rootElement = document.getElementById( 'fair-events-whatsapp-root' );
	if ( rootElement ) {
		createRoot( rootElement ).render( <WhatsAppPage /> );
	}
} );
