/**
 * Standalone Event Statistics page
 *
 * Statistics read Fair Events' own records once payment records are moved
 * to Fair Events, and Fair Audience's records before that. When neither can
 * be read the page explains how to make them available instead of
 * rendering charts that cannot load.
 *
 * @package FairEvents
 */

import { Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import EventStatistics from './EventStatistics.js';

export default function StatisticsPage( {
	eventDateId,
	statisticsAvailable,
	manageEventUrl,
	paymentHistoryUrl,
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
				{ eventDateId && manageEventUrl ? (
					<p>
						<a
							href={ `${ manageEventUrl }&event_date_id=${ eventDateId }` }
						>
							{ __( 'Back to Manage Event', 'fair-events' ) }
						</a>
					</p>
				) : null }
			</Notice>
		);
	}

	return <EventStatistics eventDateId={ eventDateId } />;
}
