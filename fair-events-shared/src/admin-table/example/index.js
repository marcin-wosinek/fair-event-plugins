/**
 * Entry of the admin table review example (#2205). Built by
 * `npm run build` in fair-events-shared into
 * `e2e/mu-plugins/admin-table-example/build/` (gitignored) and served only on
 * the wp-env tests site.
 *
 * @package FairEventsShared
 */

import { createRoot } from '@wordpress/element';

import '../style.css';
import './example.css';
import ExampleApp from './ExampleApp.js';

function mount() {
	const root = document.getElementById( 'fair-admin-table-example-root' );
	if ( root ) {
		createRoot( root ).render( <ExampleApp /> );
	}
}

if ( 'loading' === document.readyState ) {
	document.addEventListener( 'DOMContentLoaded', mount );
} else {
	mount();
}
