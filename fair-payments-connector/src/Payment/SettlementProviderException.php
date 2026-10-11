<?php
/**
 * Settlement provider failure
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Payment;

defined( 'WPINC' ) || die;

/**
 * A Mollie settlement request that could not be completed.
 *
 * Carries only a safe failure category; the provider's own message never
 * leaves the adapter.
 */
class SettlementProviderException extends \Exception {

	const NOT_CONNECTED    = 'mollie_not_connected';
	const ACCESS_DENIED    = 'settlement_access_missing';
	const REQUEST_FAILED   = 'mollie_request_failed';
	const INVALID_RESPONSE = 'mollie_invalid_response';

	/**
	 * Safe failure category.
	 *
	 * @var string
	 */
	private $category;

	/**
	 * Constructor.
	 *
	 * @param string $category One of the class constants.
	 */
	public function __construct( $category ) {
		parent::__construct( $category );
		$this->category = $category;
	}

	/**
	 * Safe failure category.
	 *
	 * @return string
	 */
	public function get_category() {
		return $this->category;
	}
}
