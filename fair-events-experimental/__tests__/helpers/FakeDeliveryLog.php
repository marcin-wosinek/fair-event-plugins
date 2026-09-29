<?php
/**
 * FakeDeliveryLog test double.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WeeklyNotifications;

/**
 * In-memory delivery record with the table's unique-key semantics.
 */
class FakeDeliveryLog {

	/**
	 * Rows keyed by week|provider|destination|part.
	 *
	 * @var array[]
	 */
	public $rows = array();

	/**
	 * Claim a part.
	 *
	 * @param string $week_start  Week.
	 * @param string $provider    Provider.
	 * @param string $destination Destination.
	 * @param int    $part        Part.
	 * @param int    $part_count  Parts.
	 * @param string $state       State.
	 * @param string $code        Code.
	 * @return bool
	 */
	public function claim( $week_start, $provider, $destination, $part, $part_count, $state = 'sending', $code = '' ) {
		$key = implode( '|', array( $week_start, $provider, $destination, $part ) );
		if ( isset( $this->rows[ $key ] ) ) {
			return false;
		}
		$this->rows[ $key ] = array(
			'state' => $state,
			'code'  => $code,
		);
		return true;
	}

	/**
	 * Finish a part.
	 *
	 * @param string $week_start  Week.
	 * @param string $provider    Provider.
	 * @param string $destination Destination.
	 * @param int    $part        Part.
	 * @param array  $result      Result.
	 * @return void
	 */
	public function finish( $week_start, $provider, $destination, $part, array $result ) {
		$key                = implode( '|', array( $week_start, $provider, $destination, $part ) );
		$this->rows[ $key ] = array(
			'state' => $result['state'],
			'code'  => $result['code'],
		);
	}

	/**
	 * State of a part.
	 *
	 * @param string $destination Destination.
	 * @param int    $part        Part.
	 * @return string|null
	 */
	public function state( $destination, $part ) {
		return $this->rows[ '2026-09-14|fake|' . $destination . '|' . $part ]['state'] ?? null;
	}
}
