<?php
/**
 * Events listed by the individual email notification.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Services\WeeklyEventsProvider;

defined( 'WPINC' ) || die;

/**
 * Resolves an event selection to a week's public events.
 *
 * A selection is either every published event of this site or one enabled
 * event source. A source that was deleted or disabled is an error: the email
 * never falls back to a wider selection than the one that was saved. The
 * events come from {@see WeeklyEventsProvider::for_notification()}, like
 * every other notification channel's.
 */
class IndividualEmailEvents {

	/**
	 * Check that a selection can still be resolved.
	 *
	 * @param string $selection {@see IndividualEmailSettings::LOCAL_EVENTS} or an event source slug.
	 * @return true|\WP_Error
	 */
	public function check( $selection ) {
		return ( new WeeklyEventsProvider() )->check_selection( $selection );
	}

	/**
	 * Published occurrences of a selection in a week, in display order.
	 *
	 * @param string                            $selection {@see IndividualEmailSettings::LOCAL_EVENTS} or an event source slug.
	 * @param array{start: string, end: string} $week      Week boundaries.
	 * @return array[]|\WP_Error Occurrence DTOs, or why the selection cannot be resolved.
	 */
	public function for_week( $selection, array $week ) {
		$events = ( new WeeklyEventsProvider() )->for_notification( $week, $selection );

		return is_wp_error( $events ) ? $events : $events['occurrences'];
	}
}
