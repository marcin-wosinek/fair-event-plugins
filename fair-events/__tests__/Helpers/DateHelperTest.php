<?php
/**
 * Tests for DateHelper's timezone-aware formatting.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Helpers;

use PHPUnit\Framework\TestCase;
use FairEvents\Helpers\DateHelper;

/**
 * Unit tests for local_to_iso8601() and local_to_datetime().
 */
class DateHelperTest extends TestCase {

	/**
	 * Reset the timezone stub after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['_fair_test_timezone'] );

		parent::tearDown();
	}

	/**
	 * A summer date on a named DST zone emits the summer offset.
	 *
	 * @return void
	 */
	public function test_local_to_iso8601_summer_offset() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$iso = DateHelper::local_to_iso8601( '2025-06-15 18:15:00' );

		$this->assertSame( '2025-06-15T18:15:00+02:00', $iso );
	}

	/**
	 * A winter date on a named DST zone emits the winter offset.
	 *
	 * @return void
	 */
	public function test_local_to_iso8601_winter_offset() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$iso = DateHelper::local_to_iso8601( '2025-01-15 18:15:00' );

		$this->assertSame( '2025-01-15T18:15:00+01:00', $iso );
	}

	/**
	 * A fixed-offset site timezone emits that fixed offset, no DST math.
	 *
	 * @return void
	 */
	public function test_local_to_iso8601_fixed_offset() {
		$GLOBALS['_fair_test_timezone'] = '+05:00';

		$iso = DateHelper::local_to_iso8601( '2025-06-15 18:15:00' );

		$this->assertSame( '2025-06-15T18:15:00+05:00', $iso );
	}

	/**
	 * An invalid datetime string yields an empty string, not a fatal error.
	 *
	 * @return void
	 */
	public function test_local_to_iso8601_invalid_datetime() {
		$this->assertSame( '', DateHelper::local_to_iso8601( 'not-a-date' ) );
	}

	/**
	 * Local_to_datetime() returns a DateTime carrying the site timezone.
	 *
	 * @return void
	 */
	public function test_local_to_datetime_carries_site_timezone() {
		$GLOBALS['_fair_test_timezone'] = 'Europe/Madrid';

		$dt = DateHelper::local_to_datetime( '2025-06-15 18:15:00' );

		$this->assertInstanceOf( \DateTime::class, $dt );
		$this->assertSame( 'Europe/Madrid', $dt->getTimezone()->getName() );
		$this->assertSame( '2025-06-15 18:15:00', $dt->format( 'Y-m-d H:i:s' ) );
	}

	/**
	 * Local_to_datetime() returns false on an invalid datetime string.
	 *
	 * @return void
	 */
	public function test_local_to_datetime_invalid_datetime() {
		$this->assertFalse( DateHelper::local_to_datetime( 'not-a-date' ) );
	}
}
