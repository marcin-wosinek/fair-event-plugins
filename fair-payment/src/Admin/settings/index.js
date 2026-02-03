/**
 * WordPress dependencies
 */
import domReady from '@wordpress/dom-ready';
import { render } from '@wordpress/element';

/**
 * Internal dependencies
 */
import SettingsApp from './SettingsApp.js';

/**
 * Initialize the settings page
 */
domReady( () => {
	const root = document.getElementById( 'fair-payment-settings-root' );
	if ( root ) {
		render( <SettingsApp />, root );
	}
} );
