/**
 * Standalone Event Statistics page
 *
 * The statistics come from Fair Audience's participant and payment data, so
 * without that plugin the page explains the missing dependency instead of
 * rendering charts that cannot load.
 *
 * @package FairEvents
 */

import { Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import EventStatistics from './EventStatistics.js';

export default function StatisticsPage( {
	eventDateId,
	audienceActive,
	manageEventUrl,
} ) {
	if ( ! audienceActive ) {
		return (
			<Notice status="warning" isDismissible={ false }>
				<p>
					{ __(
						'Event statistics need the Fair Audience plugin, which records tickets and payments. Activate Fair Audience to see sales and activity charts for this event.',
						'fair-events'
					) }
				</p>
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
