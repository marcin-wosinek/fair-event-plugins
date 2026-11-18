<?php
/**
 * SalesSummarySettings tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\SalesSummarySettings;
use PHPUnit\Framework\TestCase;

/**
 * Sales summary preferences: off by default, a fallback address before
 * turning one on, and each report stored apart from the others.
 */
class SalesSummarySettingsTest extends TestCase {

	/**
	 * Reset options.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/** A report never saved is off. */
	public function test_new_reports_are_off() {
		$this->assertSame( 'off', SalesSummarySettings::get( 'central' )['frequency'] );
		$this->assertFalse( SalesSummarySettings::is_enabled( SalesSummarySettings::get( 'default' ) ) );
	}

	/** Turning a report on requires a fallback address. */
	public function test_turning_on_requires_a_fallback() {
		$result = SalesSummarySettings::validate( array( 'frequency' => 'daily' ) );
		$this->assertArrayHasKey( 'fallback_email', $result['errors'] );

		$result = SalesSummarySettings::validate(
			array(
				'frequency'      => 'daily',
				'fallback_email' => 'team@example.com',
			)
		);
		$this->assertSame( array(), $result['errors'] );
		$this->assertSame( 'team@example.com', $result['settings']['fallback_email'] );
	}

	/** Invalid values are reported per field, never repaired. */
	public function test_invalid_values_are_reported() {
		$result = SalesSummarySettings::validate(
			array(
				'frequency'      => 'hourly',
				'time_of_day'    => '25:00',
				'day_of_week'    => 8,
				'fallback_email' => 'a@example.com, b@example.com',
			)
		);
		$this->assertSame( array( 'frequency', 'time_of_day', 'day_of_week', 'fallback_email' ), array_keys( $result['errors'] ) );
	}

	/** Saving one report keeps every other report, and stored data without a fallback stays off. */
	public function test_reports_are_stored_apart() {
		SalesSummarySettings::save(
			'central',
			array(
				'frequency'      => 'weekly',
				'time_of_day'    => '09:00',
				'day_of_week'    => 2,
				'fallback_email' => 'team@example.com',
			)
		);
		SalesSummarySettings::save( 'default', array( 'frequency' => 'daily' ) );

		$this->assertSame( 'weekly', SalesSummarySettings::get( 'central' )['frequency'] );
		$this->assertSame( 'off', SalesSummarySettings::get( 'default' )['frequency'] );
		$this->assertSame( array( 'central', 'default' ), array_keys( SalesSummarySettings::all() ) );
		$this->assertArrayNotHasKey( 'fair_events_organizer', $GLOBALS['_fair_test_options'] );
	}

	/** Only the central summary, the default organizer and UUIDs name reports. */
	public function test_report_keys() {
		$this->assertTrue( SalesSummarySettings::valid_key( 'central' ) );
		$this->assertTrue( SalesSummarySettings::valid_key( '11111111-1111-4111-8111-111111111111' ) );
		$this->assertFalse( SalesSummarySettings::valid_key( 'other' ) );
	}
}
