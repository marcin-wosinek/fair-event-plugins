<?php
/**
 * FakeSalesStatistics test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Services\SalesSummaryStatistics;

/**
 * Sales figures for every period.
 */
class FakeSalesStatistics extends SalesSummaryStatistics {

	/**
	 * Events returned.
	 *
	 * @var array[]
	 */
	public $events = array();

	/**
	 * Requested bounds.
	 *
	 * @var array[]
	 */
	public $requests = array();

	/**
	 * Events of a period.
	 *
	 * @param string $from Start.
	 * @param string $to   End.
	 * @return array[]
	 */
	public function for_period( $from, $to ) {
		$this->requests[] = array( $from, $to );
		return $this->events;
	}

	/**
	 * One event row.
	 *
	 * @param int    $id      Event ID.
	 * @param string $title   Title.
	 * @param int    $tickets Tickets in the period.
	 * @param float  $revenue Revenue in the period.
	 * @param string $state   Revenue state.
	 * @return array
	 */
	public static function event( $id, $title, $tickets, $revenue, $state = 'available' ) {
		$summary = static function ( $total ) use ( $state ) {
			return array(
				'state'               => $state,
				'currency'            => 'EUR',
				'total'               => 'unavailable' === $state ? null : $total,
				'daily'               => array(),
				'excluded_currencies' => array(),
				'unresolved'          => 0,
				'series_pass_revenue' => null,
			);
		};
		return array(
			'event_id'       => $id,
			'title'          => $title,
			'is_series'      => false,
			'period_tickets' => $tickets,
			'total_tickets'  => $tickets * 3,
			'period_revenue' => $summary( $revenue ),
			'total_revenue'  => $summary( $revenue * 3 ),
		);
	}
}
