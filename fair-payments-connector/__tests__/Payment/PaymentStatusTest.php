<?php
/**
 * PaymentStatus canonical-mapping tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Payment;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Payment\PaymentStatus;

/**
 * Unit tests for the raw-transaction-status → canonical-lifecycle-status mapper.
 */
class PaymentStatusTest extends TestCase {

	/**
	 * Assert each raw status maps to its canonical lifecycle status.
	 *
	 * @dataProvider raw_status_provider
	 *
	 * @param string $raw_status Raw transaction status.
	 * @param string $expected   Expected canonical lifecycle status.
	 */
	public function test_from_raw_status_maps_correctly( string $raw_status, string $expected ): void {
		$this->assertSame( $expected, PaymentStatus::from_raw_status( $raw_status ) );
	}

	/**
	 * Data provider of raw statuses and their expected canonical mapping.
	 *
	 * @return array<string, array{0: string, 1: string}>
	 */
	public function raw_status_provider(): array {
		return array(
			'paid maps to confirmed'                  => array( 'paid', PaymentStatus::CONFIRMED ),
			'failed maps to failed'                   => array( 'failed', PaymentStatus::FAILED ),
			'canceled maps to failed'                 => array( 'canceled', PaymentStatus::FAILED ),
			'expired maps to failed'                  => array( 'expired', PaymentStatus::FAILED ),
			'pending_payment maps to processing'      => array( 'pending_payment', PaymentStatus::PROCESSING ),
			'draft maps to processing'                => array( 'draft', PaymentStatus::PROCESSING ),
			'authorized maps to processing'           => array( 'authorized', PaymentStatus::PROCESSING ),
			'unknown status falls back to processing' => array( 'some_unrecognized_status', PaymentStatus::PROCESSING ),
			'empty string falls back to processing'   => array( '', PaymentStatus::PROCESSING ),
		);
	}
}
