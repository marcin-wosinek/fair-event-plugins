/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';

/**
 * Internal dependencies
 */
import TransactionsApp from './TransactionsApp.js';
import 'fair-events-shared/src/admin-table/style.css';
import './style.scss';

/**
 * Initialize the transactions page
 */
domReady( () => {
	const root = document.getElementById(
		'fair-payments-connector-transactions-root'
	);
	if ( root ) {
		createRoot( root ).render( <TransactionsApp /> );
	}
} );
