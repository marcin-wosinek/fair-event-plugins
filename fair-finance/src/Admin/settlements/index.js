/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import SettlementsApp from './SettlementsApp.js';
import './style.scss';

/**
 * Initialize the settlements page
 */
domReady( () => {
	const root = document.getElementById( 'fair-finance-settlements-root' );
	if ( root ) {
		createRoot( root ).render( <SettlementsApp /> );
	}
} );
