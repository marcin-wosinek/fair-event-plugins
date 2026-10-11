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
	 * Requests as [source, year, week].
	 *
	 * @var array[]
	 */
	public $requests = array();

	/**
	 * Week of events.
	 *
	 * @param string $source_slug Source.
	 * @param int    $year        ISO year.
	 * @param int    $week        ISO week.
	 * @return array|\WP_Error
	 */
	public function get_week( $source_slug, $year, $week ) {
		$this->requests[] = array( $source_slug, $year, $week );
		if ( $this->error ) {
			return new \WP_Error( 'not_found', 'Event source not found.' );
		}

		$start = ( new \DateTimeImmutable( 'now', new \DateTimeZone( 'UTC' ) ) )->setISODate( $year, $week );

		return array(
			'week' => array(
				'year'  => $year,
				'week'  => $week,
				'start' => $start->format( 'Y-m-d' ),
				'end'   => $start->modify( '+6 days' )->format( 'Y-m-d' ),
			),
			'days' => array(
				array( 'events' => $this->empty ? array() : array( array( 'title' => 'Concert' ) ) ),
			),
		);
	}
}
