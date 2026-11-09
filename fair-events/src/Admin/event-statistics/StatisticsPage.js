/**
 * Standalone Event Statistics page
 *
 * Opened from bookmarks of the former standalone Statistics page; Manage
 * Event shows the same view in its Statistics tab. Statistics read Fair
 * Events' own records once payment records are moved to Fair Events (at
 * once on a site that never had Fair Audience), and Fair Audience's records
 * before that. When neither can be read the page explains how to make them
 * available instead of rendering charts that cannot load.
 *
 * @package FairEvents
 */

import { Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import EventStatistics from './EventStatistics.js';

function PageContent( {
	eventDateId,
	statisticsAvailable,
	paymentHistoryUrl,
	allEventsUrl,
} ) {
	if ( ! statisticsAvailable ) {
		return (
			<Notice status="warning" isDismissible={ false }>
				<p>
					{ __(
						'Event statistics aren’t available yet. Activate Fair Audience, or move its payment records to Fair Events on the Payment history page.',
						'fair-events'
					) }
				</p>
				{ paymentHistoryUrl ? (
					<p>
						<a href={ paymentHistoryUrl }>
							{ __( 'Open Payment history', 'fair-events' ) }
						</a>
					</p>
				) : null }
			</Notice>
		);
	}

	// A bookmark without an event date would otherwise render nothing.
	if ( ! eventDateId ) {
		return (
			<Notice status="warning" isDismissible={ false }>
				<p>
					{ __(
						'No event is selected. Open Statistics from an event’s Manage Event page.',
						'fair-events'
					) }
				</p>
				{ allEventsUrl ? (
					<p>
						<a href={ allEventsUrl }>
							{ __( 'Go to All Events', 'fair-events' ) }
						</a>
					</p>
				) : null }
			</Notice>
		);
	}

	return <EventStatistics eventDateId={ eventDateId } showEventHeading />;
}

export default function StatisticsPage( {
	eventDateId,
	statisticsAvailable,
	manageEventUrl,
	paymentHistoryUrl,
	allEventsUrl,
} ) {
	return (
		<div className="wrap fair-event-statistics-page">
			<h1>{ __( 'Event Statistics', 'fair-events' ) }</h1>
			{ eventDateId && manageEventUrl ? (
				<p className="fair-event-statistics-page__back">
					<a
						href={ `${ manageEventUrl }&event_date_id=${ eventDateId }` }
					>
						{ __( 'Back to Manage Event', 'fair-events' ) }
					</a>
				</p>
			) : null }
			<PageContent
				eventDateId={ eventDateId }
				statisticsAvailable={ statisticsAvailable }
				paymentHistoryUrl={ paymentHistoryUrl }
				allEventsUrl={ allEventsUrl }
			/>
		</div>
	);
}
