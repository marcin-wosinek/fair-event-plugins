/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import InstagramPage from './InstagramPage.js';

domReady( () => {
	const rootElement = document.getElementById( 'fair-events-instagram-root' );
	if ( rootElement ) {
		createRoot( rootElement ).render( <InstagramPage /> );
	}
} );
