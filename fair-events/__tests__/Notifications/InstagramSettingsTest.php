<?php
/**
 * InstagramSettings unit tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\Configurations;
use FairEvents\Notifications\InstagramSettings;
use PHPUnit\Framework\TestCase;

/**
 * Settings of an Instagram notification: off by default, each field coerced,
 * and kept per configuration.
 */
class InstagramSettingsTest extends TestCase {

	/** Reset the stubs. */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/** Starts off. */
	public function test_starts_off() {
		$this->assertFalse( InstagramSettings::defaults()['enabled'] );
	}

	/** Normalizes invalid values to defaults. */
	public function test_normalizes_invalid_values_to_defaults() {
		$settings = InstagramSettings::normalize(
			array(
				'enabled'     => 1,
				'source_slug' => 'Local Feed!',
				'page_id'     => -4,
				'day_of_week' => 9,
				'time_of_day' => '25:00',
				'week_scope'  => 'last',
				'chat_ids'    => array( '@nope' ),
			)
		);

		$this->assertSame(
			array(
				'enabled'     => true,
				'source_slug' => 'localfeed',
				'page_id'     => 0,
				'day_of_week' => 1,
				'time_of_day' => '09:00',
				'week_scope'  => 'current',
			),
			$settings
		);
	}

	/** Configurations are independent. */
	public function test_configurations_are_independent() {
		$first  = Configurations::create( Configurations::INSTAGRAM, 'First', InstagramSettings::defaults() )['id'];
		$second = Configurations::create( Configurations::INSTAGRAM, 'Second', InstagramSettings::defaults() )['id'];

		InstagramSettings::save(
			$first,
			array(
				'enabled'     => true,
				'day_of_week' => 5,
				'time_of_day' => '18:30',
				'week_scope'  => 'next',
			)
		);

		$this->assertSame( 5, InstagramSettings::get( $first )['day_of_week'] );
		$this->assertSame( 'next', InstagramSettings::get( $first )['week_scope'] );
		$this->assertFalse( InstagramSettings::get( $second )['enabled'] );
		$this->assertSame( 1, InstagramSettings::get( $second )['day_of_week'] );
	}

	/** Instagram is not migrated from single settings. */
	public function test_instagram_is_not_migrated_from_single_settings() {
		$this->assertContains( Configurations::INSTAGRAM, Configurations::TYPES );
		$this->assertNotContains( Configurations::INSTAGRAM, Configurations::LEGACY_TYPES );
	}
}
