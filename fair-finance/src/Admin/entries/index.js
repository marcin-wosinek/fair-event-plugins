/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import EntriesApp from './EntriesApp.js';
import 'fair-events-shared/src/admin-table/style.css';
import './style.scss';

/**
 * Initialize the entries page
 */
domReady( () => {
	const root = document.getElementById( 'fair-finance-entries-root' );
	if ( root ) {
		createRoot( root ).render( <EntriesApp /> );
	}
} );
