<?php
/**
 * Exact decimal handling for settlement report amounts.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Settlements;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Settlements\Decimal;
use FairPaymentsConnector\Settlements\ReportDecimal;
use PHPUnit\Framework\Attributes\DataProvider;

/**
 * Unit tests for ReportDecimal.
 */
class ReportDecimalTest extends TestCase {

	/**
	 * Report values and how they are kept.
	 *
	 * @return array[]
	 */
	public static function valid_values() {
		return array(
			'fractional cents'        => array( '0.7545', '0.7545' ),
			'negative rounding line'  => array( '-0.0045', '-0.0045' ),
			'trailing zeros kept'     => array( '2.5410', '2.5410' ),
			'four zero decimals kept' => array( '1.5300', '1.5300' ),
			'two decimals kept'       => array( '0.25', '0.25' ),
			'no decimals kept'        => array( '12', '12' ),
			'zero keeps its scale'    => array( '0.0000', '0.0000' ),
			'negative zero'           => array( '-0.0000', '0.0000' ),
			'explicit plus sign'      => array( '+1.80', '1.80' ),
			'leading zeros'           => array( '007.1000', '7.1000' ),
			'integer input'           => array( 4, '4' ),
			'widest accepted value'   => array( '999999999999999.99999999', '999999999999999.99999999' ),
		);
	}

	/**
	 * A report value keeps the sign and scale it was supplied with.
	 *
	 * @param mixed  $raw      Raw value.
	 * @param string $expected Kept value.
	 */
	#[DataProvider( 'valid_values' )]
	public function test_parse_keeps_the_supplied_precision( $raw, $expected ) {
		$this->assertSame( $expected, ReportDecimal::parse( $raw ) );
	}

	/**
	 * Values that are refused instead of being cut short or guessed at.
	 *
	 * @return array[]
	 */
	public static function invalid_values() {
		return array(
			'more decimals than bounded' => array( '0.123456789' ),
			'more digits than bounded'   => array( '1000000000000000.00' ),
			'comma decimal'              => array( '0,7545' ),
			'thousands separator'        => array( '1,234.50' ),
			'exponent'                   => array( '1e3' ),
			'text'                       => array( 'ten' ),
			'empty'                      => array( '' ),
			'trailing separator'         => array( '1.' ),
			'float'                      => array( 0.7545 ),
			'null'                       => array( null ),
			'array'                      => array( array( '1.00' ) ),
		);
	}

	/**
	 * An unreadable value is refused, never truncated.
	 *
	 * @param mixed $raw Raw value.
	 */
	#[DataProvider( 'invalid_values' )]
	public function test_parse_refuses_what_it_cannot_keep_exactly( $raw ) {
		$this->assertNull( ReportDecimal::parse( $raw ) );
	}

	/** The currency validator still refuses what the report path accepts. */
	public function test_currency_validation_stays_strict() {
		$this->assertNull( Decimal::normalize( '0.7545', 'EUR' ) );
		$this->assertSame( '0.7545', ReportDecimal::parse( '0.7545' ) );
	}

	/** Fees with fractional cents and a negative rounding line add up exactly. */
	public function test_sum_adds_fractional_cents_exactly() {
		$fees = array( '0.7545', '1.5300', '1.3700', '0.2500', '-0.0045' );

		$this->assertSame( '3.9000', ReportDecimal::sum( $fees ) );
	}

	/** The result is written at the largest scale among the values. */
	public function test_sum_uses_the_largest_scale() {
		$this->assertSame( '40.00', ReportDecimal::sum( array( '25.00', '15.00' ) ) );
		$this->assertSame( '36.1000', ReportDecimal::sum( array( '40.00', '-3.9000' ) ) );
		$this->assertSame( '1.755', ReportDecimal::sum( array( '1', '0.75', '0.005' ) ) );
		$this->assertSame( '0', ReportDecimal::sum( array() ) );
	}

	/** Signs are handled in both directions, through zero. */
	public function test_sum_crosses_zero() {
		$this->assertSame( '-0.0045', ReportDecimal::sum( array( '1.00', '-1.0045' ) ) );
		$this->assertSame( '0.0045', ReportDecimal::sum( array( '-1.00', '1.0045' ) ) );
		$this->assertSame( '0.0000', ReportDecimal::sum( array( '0.0045', '-0.0045' ) ) );
		$this->assertSame( '-3.00', ReportDecimal::sum( array( '-1.00', '-2.00' ) ) );
	}

	/** Values beyond native integers and floats stay exact. */
	public function test_sum_does_not_overflow() {
		$this->assertSame(
			'1999999999999999.99999998',
			ReportDecimal::sum( array( '999999999999999.99999999', '999999999999999.99999999' ) )
		);
		$this->assertSame( '0.30', ReportDecimal::sum( array( '0.10', '0.20' ) ) );
	}

	/** Subtraction gives the exact residual. */
	public function test_subtract_gives_the_exact_residual() {
		$this->assertSame( '0.0000', ReportDecimal::subtract( '36.1000', '36.10' ) );
		$this->assertSame( '-0.0045', ReportDecimal::subtract( '36.0955', '36.10' ) );
		$this->assertSame( '0.0045', ReportDecimal::subtract( '36.1045', '36.10' ) );
	}

	/** Negating keeps the scale and leaves zero unsigned. */
	public function test_negate_keeps_scale() {
		$this->assertSame( '-0.7545', ReportDecimal::negate( '0.7545' ) );
		$this->assertSame( '0.0045', ReportDecimal::negate( '-0.0045' ) );
		$this->assertSame( '0.0000', ReportDecimal::negate( '0.0000' ) );
	}

	/** Amounts are compared by value, not by spelling. */
	public function test_compare_ignores_spelling() {
		$this->assertTrue( ReportDecimal::equals( '0.7500', '0.75' ) );
		$this->assertTrue( ReportDecimal::equals( '36.1000', '36.10' ) );
		$this->assertFalse( ReportDecimal::equals( '36.1045', '36.10' ) );
		$this->assertSame( -1, ReportDecimal::compare( '-0.0045', '0' ) );
		$this->assertSame( 1, ReportDecimal::compare( '10.00', '9.9999' ) );
		$this->assertSame( -1, ReportDecimal::compare( '-10.00', '-9.9999' ) );
		$this->assertSame( 0, ReportDecimal::compare( '0.00', '0' ) );
	}

	/** Equivalent spellings share one form for hashing; the stored value is untouched. */
	public function test_canonical_is_one_spelling_per_amount() {
		$this->assertSame( '0.75', ReportDecimal::canonical( '0.7500' ) );
		$this->assertSame( '0.75', ReportDecimal::canonical( '0.75' ) );
		$this->assertSame( '100', ReportDecimal::canonical( '100' ) );
		$this->assertSame( '100', ReportDecimal::canonical( '100.00' ) );
		$this->assertSame( '0', ReportDecimal::canonical( '0.0000' ) );
		$this->assertSame( '-0.0045', ReportDecimal::canonical( '-0.0045' ) );
	}

	/** Zero is recognized at any scale. */
	public function test_is_zero() {
		$this->assertTrue( ReportDecimal::is_zero( '0' ) );
		$this->assertTrue( ReportDecimal::is_zero( '0.0000' ) );
		$this->assertFalse( ReportDecimal::is_zero( '0.0001' ) );
		$this->assertFalse( ReportDecimal::is_zero( '-0.0045' ) );
	}
}
