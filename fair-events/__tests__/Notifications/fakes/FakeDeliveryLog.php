<?php
/**
 * FakeDeliveryLog test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

/**
 * In-memory delivery record with the table's unique-key semantics: one row
 * per configuration, week, provider, destination and part.
 */
class FakeDeliveryLog {

	/**
	 * Rows keyed by configuration|week|provider|destination|part.
	 *
	 * @var array[]
	 */
	public $rows = array();

	/**
	 * Claim a part.
	 *
	 * @param string $config_id   Configuration.
	 * @param string $week_start  Week.
	 * @param string $provider    Provider.
	 * @param string $destination Destination.
	 * @param int    $part        Part.
	 * @param int    $part_count  Parts.
	 * @param string $state       State.
	 * @param string $code        Code.
	 * @return bool
	 */
	public function claim( $config_id, $week_start, $provider, $destination, $part, $part_count, $state = 'sending', $code = '' ) {
		$key = implode( '|', array( $config_id, $week_start, $provider, $destination, $part ) );
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
	 * @param string $config_id   Configuration.
	 * @param string $week_start  Week.
	 * @param string $provider    Provider.
	 * @param string $destination Destination.
	 * @param int    $part        Part.
	 * @param array  $result      Result.
	 * @return void
	 */
	public function finish( $config_id, $week_start, $provider, $destination, $part, array $result ) {
		$key                = implode( '|', array( $config_id, $week_start, $provider, $destination, $part ) );
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
	 * @param string $config_id   Configuration.
	 * @return string|null
	 */
	public function state( $destination, $part, $config_id = 'telegram' ) {
		return $this->rows[ $config_id . '|2026-09-14|fake|' . $destination . '|' . $part ]['state'] ?? null;
	}
}
