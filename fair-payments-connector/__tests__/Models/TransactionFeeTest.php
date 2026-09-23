<?php
/**
 * Transaction integration-fee calculation tests.
 *
 * Covers the launch-waiver boundary (midnight on 1 January 2027 in the site
 * timezone) and the uncapped 2% rate after it (#1655).
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Models;

use DateTimeImmutable;
use DateTimeZone;
use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Models\Transaction;

/**
 * Unit tests for Transaction::calculate_application_fee() and create().
 */
class TransactionFeeTest extends TestCase {

	/**
	 * Reset the fake $wpdb and site timezone between tests.
	 */
	protected function setUp(): void {
		$GLOBALS['wpdb']->inserted_rows = array();
		unset( $GLOBALS['_fair_test_timezone'] );
	}

	/**
	 * Clean up the site timezone override.
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );
	}

	/**
	 * Timezones the cutoff is evaluated in.
	 *
	 * @return array<string,array{string}>
	 */
	public function timezones(): array {
		return array(
			'UTC'           => array( 'UTC' ),
			'Europe/Madrid' => array( 'Europe/Madrid' ),
		);
	}

	/**
	 * Build a moment in the given timezone.
	 *
	 * @param string $datetime Local datetime.
	 * @param string $timezone Timezone identifier.
	 * @return DateTimeImmutable
	 */
	private function moment( string $datetime, string $timezone ): DateTimeImmutable {
		return new DateTimeImmutable( $datetime, new DateTimeZone( $timezone ) );
	}

	/**
	 * One second before local midnight is still waived.
	 *
	 * @dataProvider timezones
	 * @param string $timezone Site timezone.
	 */
	public function test_fee_is_waived_immediately_before_the_cutoff( string $timezone ) {
		$fee = Transaction::calculate_application_fee( 100, $this->moment( '2026-12-31 23:59:59', $timezone ), new DateTimeZone( $timezone ) );
		$this->assertSame( 0.0, $fee );
	}

	/**
	 * Local midnight on 1 January 2027 is charged.
	 *
	 * @dataProvider timezones
	 * @param string $timezone Site timezone.
	 */
	public function test_fee_is_charged_exactly_at_the_cutoff( string $timezone ) {
		$fee = Transaction::calculate_application_fee( 100, $this->moment( '2027-01-01 00:00:00', $timezone ), new DateTimeZone( $timezone ) );
		$this->assertSame( 2.0, $fee );
	}

	/**
	 * Later transactions are charged 2%.
	 *
	 * @dataProvider timezones
	 * @param string $timezone Site timezone.
	 */
	public function test_fee_is_charged_after_the_cutoff( string $timezone ) {
		$fee = Transaction::calculate_application_fee( 250, $this->moment( '2027-06-15 12:00:00', $timezone ), new DateTimeZone( $timezone ) );
		$this->assertSame( 5.0, $fee );
	}

	/**
	 * The cutoff is site-local midnight, not UTC midnight: 23:30 UTC on
	 * 31 December is already 00:30 on 1 January in Madrid.
	 */
	public function test_cutoff_follows_the_site_timezone_not_utc() {
		$moment = $this->moment( '2026-12-31 23:30:00', 'UTC' );

		$this->assertSame( 0.0, Transaction::calculate_application_fee( 100, $moment, new DateTimeZone( 'UTC' ) ) );
		$this->assertSame( 2.0, Transaction::calculate_application_fee( 100, $moment, new DateTimeZone( 'Europe/Madrid' ) ) );
	}

	/**
	 * Fees round to cents.
	 */
	public function test_fee_rounds_to_cents() {
		$after = $this->moment( '2027-02-01 10:00:00', 'UTC' );

		$this->assertSame( 0.25, Transaction::calculate_application_fee( 12.34, $after, new DateTimeZone( 'UTC' ) ) );
		$this->assertSame( 0.2, Transaction::calculate_application_fee( 9.99, $after, new DateTimeZone( 'UTC' ) ) );
	}

	/**
	 * A zero amount records no fee at all, as before.
	 */
	public function test_zero_amount_has_no_fee() {
		$after = $this->moment( '2027-02-01 10:00:00', 'UTC' );

		$this->assertNull( Transaction::calculate_application_fee( 0, $after, new DateTimeZone( 'UTC' ) ) );
	}

	/**
	 * A single fee larger than the former €12 monthly cap is not limited.
	 */
	public function test_fee_is_not_capped() {
		$after = $this->moment( '2027-02-01 10:00:00', 'UTC' );

		$this->assertSame( 40.0, Transaction::calculate_application_fee( 2000, $after, new DateTimeZone( 'UTC' ) ) );
	}

	/**
	 * Creating a transaction after the cutoff stores the uncapped 2% fee,
	 * evaluated in the site timezone.
	 */
	public function test_create_stores_the_fee_for_the_creation_moment() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		Transaction::create( array( 'amount' => 1000 ), $this->moment( '2027-01-01 00:00:00', 'Europe/Madrid' ) );
		Transaction::create( array( 'amount' => 1000 ), $this->moment( '2026-12-31 23:59:59', 'Europe/Madrid' ) );

		$rows = $GLOBALS['wpdb']->inserted_rows;
		$this->assertSame( 20.0, $rows[0]['application_fee'] );
		$this->assertSame( 0.0, $rows[1]['application_fee'] );
	}
}
