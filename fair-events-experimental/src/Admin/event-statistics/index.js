/**
 * Event Statistics Page - Entry Point
 *
 * @package FairEventsExperimental
 */

import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import EventStatistics from './EventStatistics.js';

domReady(() => {
	const container = document.getElementById(
		'fair-events-event-statistics-root'
	);
	if (container) {
		const { eventDateId } = window.fairEventsEventStatisticsData || {};
		const root = createRoot(container);
		root.render(<EventStatistics eventDateId={eventDateId} />);
	}
});
