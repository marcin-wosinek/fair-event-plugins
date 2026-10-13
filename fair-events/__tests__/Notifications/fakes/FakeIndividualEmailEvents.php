<?php
/**
 * FakeIndividualEmailEvents test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\IndividualEmailEvents;

/**
 * Stand-in for the event selection that records the weeks asked for.
 */
class FakeIndividualEmailEvents extends IndividualEmailEvents {

	/**
	 * Whether the week has no events.
	 *
	 * @var bool
	 */
	public $empty = false;

	/**
	 * Whether the selected source is gone or disabled.
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
	 * @param string $selection Selection.
	 * @param array  $week      Week boundaries.
	 * @return array[]|\WP_Error
	 */
	public function for_week( $selection, array $week ) {
		$this->requests[] = array( $selection, $week['start'], $week['end'] );
		if ( $this->error ) {
			return new \WP_Error( 'invalid_source', 'The selected event source does not exist or is disabled.' );
		}
		if ( $this->empty ) {
			return array();
		}

		return array(
			array(
				'title'   => 'Concert',
				'start'   => $week['start'] . ' 18:00:00',
				'end'     => $week['start'] . ' 20:00:00',
				'all_day' => false,
				'url'     => 'https://example.com/concert/',
			),
		);
	}
}
