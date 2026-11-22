<?php
/**
 * FakeSaleAlertSource test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\SaleAlertSource;

/**
 * Sales given by the test instead of the database.
 */
class FakeSaleAlertSource extends SaleAlertSource {

	/**
	 * Sales by transaction ID.
	 *
	 * @var array<int, array>
	 */
	public $sales = array();

	/**
	 * Owner by event date ID; a missing date owns itself.
	 *
	 * @var array<int, int>
	 */
	public $owners = array();

	/**
	 * Stored organizer by owner ID.
	 *
	 * @var array<int, string|null>
	 */
	public $assignments = array();

	/**
	 * Owner of a date.
	 *
	 * @param int $event_date_id Date ID.
	 * @return int
	 */
	public function owner_of( $event_date_id ) {
		return $this->owners[ (int) $event_date_id ] ?? (int) $event_date_id;
	}

	/**
	 * Stored organizer.
	 *
	 * @param int $owner_id Owner ID.
	 * @return string|null
	 */
	public function stored_organizer( $owner_id ) {
		return $this->assignments[ (int) $owner_id ] ?? null;
	}

	/**
	 * A sale, with the current assignment of its event.
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return array|null
	 */
	public function load( $transaction_id ) {
		$sale = $this->sales[ (int) $transaction_id ] ?? null;
		if ( $sale && $sale['event'] ) {
			$sale['event']['organizer_id'] = $this->stored_organizer( $sale['event']['id'] );
		}
		return $sale;
	}
}
