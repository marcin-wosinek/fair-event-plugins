<?php
/**
 * SignupPricing pure-logic tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairEvents\Services\SignupPricing;

/**
 * Validates the pure "is this a paid price" check used by
 * has_paid_price_configured(). DB-backed lookups (EventDates::get_by_id(),
 * TicketPricing::resolve_unit_price()) are exercised via API integration
 * tests, not here.
 */
class SignupPricingTest extends TestCase {

	/**
	 * No price configured at all.
	 */
	public function test_null_price_is_not_positive() {
		$this->assertFalse( SignupPricing::is_price_positive( null ) );
	}

	/**
	 * A price of exactly zero is a genuinely free event, not paid.
	 */
	public function test_zero_price_is_not_positive() {
		$this->assertFalse( SignupPricing::is_price_positive( 0 ) );
		$this->assertFalse( SignupPricing::is_price_positive( 0.0 ) );
	}

	/**
	 * Negative prices (shouldn't normally occur) are not treated as paid.
	 */
	public function test_negative_price_is_not_positive() {
		$this->assertFalse( SignupPricing::is_price_positive( -5.0 ) );
	}

	/**
	 * Any positive amount, including numeric strings from the DB, counts as paid.
	 */
	public function test_positive_price_is_positive() {
		$this->assertTrue( SignupPricing::is_price_positive( 10.5 ) );
		$this->assertTrue( SignupPricing::is_price_positive( '10.5' ) );
	}
}
