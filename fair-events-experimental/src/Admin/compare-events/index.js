/**
 * Compare Events Page - Entry Point
 *
 * @package FairEventsExperimental
 */

import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import CompareEventsPage from './CompareEventsPage.js';

domReady( () => {
	const container = document.getElementById(
		'fair-events-compare-events-root'
	);
	if ( container ) {
		const { statisticsAvailable } =
			window.fairEventsCompareEventsData || {};
		const root = createRoot( container );
		root.render(
			<CompareEventsPage statisticsAvailable={ !! statisticsAvailable } />
		);
	}
} );
