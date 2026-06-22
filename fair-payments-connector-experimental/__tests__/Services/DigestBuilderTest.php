<?php
/**
 * DigestBuilder Tests
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\Services;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnectorExperimental\Services\DigestBuilder;

/**
 * Unit tests for DigestBuilder — summary line and body concatenation.
 */
class DigestBuilderTest extends TestCase {

	private DigestBuilder $builder;

	protected function setUp(): void {
		$this->builder = new DigestBuilder();
	}

	private function row( string $rendered_text, string $amount, string $currency ): object {
		return (object) array(
			'rendered_text' => $rendered_text,
			'amount'        => $amount,
			'currency'      => $currency,
		);
	}

	public function test_single_row_summary_singular() {
		$result = $this->builder->build( array( $this->row( 'body', '10.00', 'EUR' ) ) );
		$this->assertStringContainsString( '1 sale', $result );
	}

	public function test_multiple_rows_summary_plural() {
		$rows = array(
			$this->row( 'a', '10.00', 'EUR' ),
			$this->row( 'b', '20.00', 'EUR' ),
		);
		$result = $this->builder->build( $rows );
		$this->assertStringContainsString( '2 sales', $result );
	}

	public function test_totals_per_currency() {
		$rows = array(
			$this->row( 'a', '10.00', 'EUR' ),
			$this->row( 'b', '5.50', 'EUR' ),
			$this->row( 'c', '20.00', 'USD' ),
		);
		$result = $this->builder->build( $rows );
		$this->assertStringContainsString( '15.50 EUR', $result );
		$this->assertStringContainsString( '20.00 USD', $result );
	}

	public function test_body_rows_are_included() {
		$rows = array(
			$this->row( 'First transaction body', '10.00', 'EUR' ),
			$this->row( 'Second transaction body', '5.00', 'EUR' ),
		);
		$result = $this->builder->build( $rows );
		$this->assertStringContainsString( 'First transaction body', $result );
		$this->assertStringContainsString( 'Second transaction body', $result );
	}

	public function test_empty_rows_returns_zero_sales() {
		$result = $this->builder->build( array() );
		$this->assertStringContainsString( '0 sales', $result );
	}

	public function test_rows_without_currency_excluded_from_totals() {
		$rows = array(
			$this->row( 'body', '10.00', '' ),
		);
		$result = $this->builder->build( $rows );
		$this->assertStringContainsString( '1 sale', $result );
		$this->assertStringNotContainsString( '·', $result );
	}
}
