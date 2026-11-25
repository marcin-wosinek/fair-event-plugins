/**
 * Public marketing assets - entry point
 *
 * Mounts the index or an occurrence's asset list into the page shell that
 * Frontend\MarketingAssetsPage renders. The shell's data attributes say
 * which view to show.
 *
 * @package FairEventsExperimental
 */

import { createRoot } from '@wordpress/element';
import App from './App.js';
import './marketing-assets.css';

export const ROOT_SELECTOR = '.fair-marketing-assets__app';

/**
 * Mount the view into every shell on the page.
 */
export function mount() {
	document.querySelectorAll( ROOT_SELECTOR ).forEach( ( root ) => {
		const view =
			'occurrence' === root.dataset.view ? 'occurrence' : 'index';
		const eventDateId =
			Number.parseInt( root.dataset.eventDateId || '', 10 ) || null;
		createRoot( root ).render(
			<App view={ view } eventDateId={ eventDateId } />
		);
	} );
}

// Deferred scripts may run after DOMContentLoaded has fired.
if ( 'loading' !== document.readyState ) {
	mount();
} else {
	document.addEventListener( 'DOMContentLoaded', mount );
}
