/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import ExternalUpdatesApp from './ExternalUpdatesApp.js';
import './style.css';

/**
 * Initialize the External Updates page
 */
domReady( () => {
	const root = document.getElementById(
		'fair-payments-connector-external-updates-root'
	);
	if ( root ) {
		createRoot( root ).render( <ExternalUpdatesApp /> );
	}
} );
