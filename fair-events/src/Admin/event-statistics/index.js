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
		const {
			eventDateId,
			statisticsAvailable,
			manageEventUrl,
			paymentHistoryUrl,
			allEventsUrl,
		} = window.fairEventsEventStatisticsData || {};
		const root = createRoot( container );
		root.render(
			<StatisticsPage
				eventDateId={ eventDateId }
				statisticsAvailable={ !! statisticsAvailable }
				manageEventUrl={ manageEventUrl }
				paymentHistoryUrl={ paymentHistoryUrl }
				allEventsUrl={ allEventsUrl }
			/>
		);
	}
} );
