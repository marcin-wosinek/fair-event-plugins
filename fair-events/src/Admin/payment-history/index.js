/**
 * Payment history page - Entry Point
 *
 * @package FairEvents
 */

import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import PaymentHistoryPage from './PaymentHistoryPage.js';
import './payment-history.css';

domReady( () => {
	const container = document.getElementById(
		'fair-events-payment-history-root'
	);
	if ( container ) {
		createRoot( container ).render( <PaymentHistoryPage /> );
	}
} );
