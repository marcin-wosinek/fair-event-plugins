<?php
/**
 * FakeWeeklyEvents test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

/**
 * Stand-in for WeeklyEventsProvider that records the weeks asked for.
 */
class FakeWeeklyEvents {

	/**
	 * Whether the week has no events.
	 *
	 * @var bool
	 */
	public $empty = false;

	/**
	 * Whether the source is unknown.
	 *
	 * @var bool
	 */
	public $error = false;

	/**
	 * Requests as [selection, week start, week end].
	 *
	 * @var array[]
	 */
	public $requests = array();

	/**
	 * Week of events.
	 *
	 * @param array  $week      Week boundaries.
	 * @param string $selection Source slug.
	 * @return array|\WP_Error
	 */
	public function for_notification( array $week, $selection ) {
		$this->requests[] = array( $selection, $week['start'], $week['end'] );
		if ( $this->error ) {
			return new \WP_Error( 'invalid_source', 'The selected event source does not exist or is disabled.' );
		}

		return array(
			'week' => $week,
			'days' => array(
				array( 'events' => $this->empty ? array() : array( array( 'title' => 'Concert' ) ) ),
			),
		);
	}
}
