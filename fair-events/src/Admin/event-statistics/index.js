/**
 * Event Statistics Page - Entry Point
 *
 * @package FairEvents
 */

import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import StatisticsPage from './StatisticsPage.js';

domReady( () => {
	const container = document.getElementById(
		'fair-events-event-statistics-root'
	);
	if ( container ) {
		const { eventDateId, audienceActive, manageEventUrl } =
			window.fairEventsEventStatisticsData || {};
		const root = createRoot( container );
		root.render(
			<StatisticsPage
				eventDateId={ eventDateId }
				audienceActive={ !! audienceActive }
				manageEventUrl={ manageEventUrl }
			/>
		);
	}
} );
