/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import MetaPage from './MetaPage.js';

// Render the app when DOM is ready
domReady( () => {
	const rootElement = document.getElementById( 'fair-events-meta-root' );
	if ( rootElement ) {
		createRoot( rootElement ).render( <MetaPage /> );
	}
} );
