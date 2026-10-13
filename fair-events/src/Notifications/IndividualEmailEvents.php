<?php
/**
 * Events listed by the individual email notification.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Database\EventSourceRepository;
use FairEvents\Services\EventsWeekSummary;

defined( 'WPINC' ) || die;

/**
 * Resolves an event selection to a week's public events.
 *
 * A selection is either every published event of this site or one enabled
 * event source. A source that was deleted or disabled is an error: the email
 * never falls back to a wider selection than the one that was saved.
 */
class IndividualEmailEvents {

	/**
	 * Check that a selection can still be resolved.
	 *
	 * @param string $selection {@see IndividualEmailSettings::LOCAL_EVENTS} or an event source slug.
	 * @return true|\WP_Error
	 */
	public function check( $selection ) {
		if ( IndividualEmailSettings::LOCAL_EVENTS === $selection ) {
			return true;
		}
		if ( ! IndividualEmailSettings::valid_selection( $selection ) ) {
			return new \WP_Error( 'missing_selection', __( 'Choose which events to include.', 'fair-events' ) );
		}

		$source = ( new EventSourceRepository() )->get_by_slug( $selection );
		if ( ! $source || empty( $source['enabled'] ) ) {
			return new \WP_Error( 'invalid_source', __( 'The selected event source does not exist or is disabled.', 'fair-events' ) );
		}

		return true;
	}

	/**
	 * Published occurrences of a selection in a week, in display order.
	 *
	 * @param string                            $selection {@see IndividualEmailSettings::LOCAL_EVENTS} or an event source slug.
	 * @param array{start: string, end: string} $week      Week boundaries.
	 * @return array[]|\WP_Error Occurrence DTOs, or why the selection cannot be resolved.
	 */
	public function for_week( $selection, array $week ) {
		$check = $this->check( $selection );
		if ( is_wp_error( $check ) ) {
			return $check;
		}

		$occurrences = EventsWeekSummary::occurrences(
			$week,
			array(
				'categories'         => array(),
				'event_source_slugs' => IndividualEmailSettings::LOCAL_EVENTS === $selection ? array() : array( $selection ),
				'include_drafts'     => false,
			),
			false
		);

		return array_values(
			array_filter(
				$occurrences,
				static function ( $occurrence ) {
					return empty( $occurrence['is_draft'] );
				}
			)
		);
	}
}
