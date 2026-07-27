<?php
/**
 * FairEventsShared\Money formatting tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Shared;

use PHPUnit\Framework\TestCase;
use FairEventsShared\Money;

/**
 * Unit tests for the shared money formatter and site-currency accessor.
 */
class MoneyTest extends TestCase {

	/**
	 * Reset the stubbed fair_payment_currency option before each test.
	 */
	protected function setUp(): void {
		parent::setUp();
		unset( $GLOBALS['_fair_test_options']['fair_payment_currency'] );
	}

	/**
	 * site_currency() defaults to EUR when the option is unset.
	 */
	public function test_site_currency_defaults_to_eur(): void {
		$this->assertSame( 'EUR', Money::site_currency() );
	}

	/**
	 * site_currency() reflects an overridden option value.
	 */
	public function test_site_currency_reflects_override(): void {
		$GLOBALS['_fair_test_options']['fair_payment_currency'] = 'PLN';
		$this->assertSame( 'PLN', Money::site_currency() );
	}

	/**
	 * format_value() produces the '.'-separated machine string.
	 */
	public function test_format_value(): void {
		$this->assertSame( '12.50', Money::format_value( 12.5 ) );
		$this->assertSame( '1234.00', Money::format_value( 1234 ) );
	}

	/**
	 * format_display() for a symbol-mapped currency (EUR).
	 */
	public function test_format_display_eur(): void {
		$this->assertSame( '12.50 EUR', Money::format_display( 12.5, 'EUR' ) );
	}

	/**
	 * format_display() for a non-EUR currency (PLN).
	 */
	public function test_format_display_pln(): void {
		$this->assertSame( '12.50 PLN', Money::format_display( 12.5, 'PLN' ) );
	}

	/**
	 * format_display() falls back to the site currency when none is given.
	 */
	public function test_format_display_defaults_to_site_currency(): void {
		$GLOBALS['_fair_test_options']['fair_payment_currency'] = 'PLN';
		$this->assertSame( '12.50 PLN', Money::format_display( 12.5 ) );
	}

	/**
	 * format_inline() for a prefix-symbol currency (EUR).
	 */
	public function test_format_inline_eur(): void {
		$this->assertSame( '€12.50', Money::format_inline( 12.5, 'EUR' ) );
	}

	/**
	 * format_inline() for a suffix-symbol currency (PLN).
	 */
	public function test_format_inline_pln(): void {
		$this->assertSame( '12.50 zł', Money::format_inline( 12.5, 'PLN' ) );
	}

	/**
	 * format_inline() falls back to format_display() for an unmapped currency (CHF).
	 */
	public function test_format_inline_unmapped_currency_falls_back_to_display(): void {
		$this->assertSame( '12.50 CHF', Money::format_inline( 12.5, 'CHF' ) );
	}

	/**
	 * symbol() returns null for an unmapped currency.
	 */
	public function test_symbol_returns_null_for_unmapped_currency(): void {
		$this->assertNull( Money::symbol( 'CHF' ) );
	}

	/**
	 * symbol() returns the mapped symbol for a known currency.
	 */
	public function test_symbol_returns_mapped_symbol(): void {
		$this->assertSame( '€', Money::symbol( 'EUR' ) );
	}

	/**
	 * The mapped currency set must match the JS twin
	 * (fair-events-shared/src/ticket-pricing.js CURRENCY_SYMBOLS) so a
	 * currency added to one side is caught if missed on the other.
	 */
	public function test_symbol_map_matches_js_currency_symbols(): void {
		$this->assertSame(
			array( 'EUR', 'USD', 'GBP', 'PLN', 'CZK', 'HUF' ),
			array_keys( Money::SYMBOLS )
		);
	}
}
