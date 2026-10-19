<?php
/**
 * Exact decimal handling for settlement amounts.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Settlements;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Settlements\Decimal;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Unit tests for Decimal.
 */
class DecimalTest extends TestCase {

	/**
	 * Valid amounts and their canonical form.
	 *
	 * @return array[]
	 */
	public static function valid_amounts() {
		return array(
			'plain'                   => array( '12.5', 'EUR', '12.50' ),
			'comma decimal'           => array( '12,50', 'EUR', '12.50' ),
			'negative'                => array( '-0.29', 'EUR', '-0.29' ),
			'negative zero'           => array( '-0.00', 'EUR', '0.00' ),
			'leading zeros'           => array( '007.10', 'EUR', '7.10' ),
			'zero-decimal currency'   => array( '1500', 'JPY', '1500' ),
			'three-decimal currency'  => array( '1.5', 'KWD', '1.500' ),
			'trailing zeros trimmed'  => array( '10.5000', 'EUR', '10.50' ),
			'unknown currency as-is'  => array( '3.125', null, '3.125' ),
			'integer input'           => array( 4, 'EUR', '4.00' ),
			'large value stays exact' => array( '90071992547409.93', 'EUR', '90071992547409.93' ),
		);
	}

	/**
	 * A valid amount keeps its exact value.
	 *
	 * @param mixed       $raw      Raw value.
	 * @param string|null $currency Currency.
	 * @param string      $expected Canonical value.
	 */
	#[DataProvider( 'valid_amounts' )]
	public function test_normalize_accepts_exact_amounts( $raw, $currency, $expected ) {
		$this->assertSame( $expected, Decimal::normalize( $raw, $currency ) );
	}

	/**
	 * Values that would have to be guessed at.
	 *
	 * @return array[]
	 */
	public static function invalid_amounts() {
		return array(
			'thousands separator'      => array( '1,234', 'EUR' ),
			'both separators'          => array( '1.234,56', 'EUR' ),
			'currency symbol'          => array( '€12.50', 'EUR' ),
			'too precise'              => array( '12.345', 'EUR' ),
			'decimals on zero-decimal' => array( '10.5', 'JPY' ),
			'text'                     => array( 'n/a', 'EUR' ),
			'empty'                    => array( '', 'EUR' ),
			'float input'              => array( 12.5, 'EUR' ),
			'exponent notation'        => array( '1e3', 'EUR' ),
		);
	}

	/**
	 * An ambiguous or malformed amount is refused, never turned into zero.
	 *
	 * @param mixed       $raw      Raw value.
	 * @param string|null $currency Currency.
	 */
	#[DataProvider( 'invalid_amounts' )]
	public function test_normalize_refuses_ambiguous_amounts( $raw, $currency ) {
		$this->assertNull( Decimal::normalize( $raw, $currency ) );
	}

	/** Sums are exact where floats are not. */
	public function test_sum_is_exact() {
		$this->assertSame( '0.30', Decimal::sum( array( '0.10', '0.20' ), 'EUR' ) );
		$this->assertSame( '-0.90', Decimal::sum( array( '-1.45', '-1.45', '2.00' ), 'EUR' ) );
		$this->assertSame( '1500', Decimal::sum( array( '1000', '500' ), 'JPY' ) );
		$this->assertSame( '0.00', Decimal::sum( array(), 'EUR' ) );
	}

	/** Minor-unit conversion round-trips, including small negatives. */
	public function test_minor_unit_round_trip() {
		$this->assertSame( -5, Decimal::to_minor( '-0.05', 'EUR' ) );
		$this->assertSame( '-0.05', Decimal::from_minor( -5, 'EUR' ) );
		$this->assertSame( '1.500', Decimal::from_minor( 1500, 'KWD' ) );
		$this->assertTrue( Decimal::equals( '10.00', '10.00', 'EUR' ) );
		$this->assertFalse( Decimal::equals( '10.00', '10.01', 'EUR' ) );
	}

	/** Currency codes are three capital letters. */
	public function test_is_currency() {
		$this->assertTrue( Decimal::is_currency( 'EUR' ) );
		$this->assertFalse( Decimal::is_currency( 'eur' ) );
		$this->assertFalse( Decimal::is_currency( 'EURO' ) );
		$this->assertFalse( Decimal::is_currency( null ) );
	}
}
