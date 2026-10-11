<?php
/**
 * FakeSummaryBuilder test double.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

/**
 * Summary builder returning a fixed result.
 */
class FakeSummaryBuilder {

	/**
	 * Result to return.
	 *
	 * @var array|\WP_Error
	 */
	public $result;

	/**
	 * Weeks requested.
	 *
	 * @var array[]
	 */
	public $weeks = array();

	/**
	 * Build.
	 *
	 * @param array $settings Settings.
	 * @param array $week     Week.
	 * @return array|\WP_Error
	 */
	public function build( array $settings, array $week ) {
		$this->weeks[] = $week;
		return $this->result;
	}
}
