<?php
/**
 * SaleAlertSettings unit tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\SaleAlertSettings;
use PHPUnit\Framework\TestCase;

/**
 * Tests ticket sale alert preferences (#2448).
 */
class SaleAlertSettingsTest extends TestCase {
	private const ORGANIZER = '0f5e6a3c-1d2b-4c3d-8e9f-0a1b2c3d4e5f';

	/**
	 * Start with no saved settings.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * Nothing is on until an administrator turns it on.
	 *
	 * @return void
	 */
	public function test_starts_off() {
		$this->assertFalse( SaleAlertSettings::any_enabled() );
		$this->assertSame( array(), SaleAlertSettings::get()['organizers'] );
		$this->assertSame(
			array(
				'enabled'     => false,
				'chat_id'     => '',
				'frequency'   => 'immediate',
				'time_of_day' => '08:00',
				'day_of_week' => 1,
			),
			SaleAlertSettings::organizer( 'default' )
		);
	}

	/**
	 * Valid chat IDs and channel names are accepted.
	 *
	 * @return void
	 */
	public function test_accepts_valid_destinations() {
		$validated = SaleAlertSettings::validate(
			array(
				'organizers' => array(
					'default'       => array(
						'enabled' => true,
						'chat_id' => ' -1001234567890 ',
					),
					self::ORGANIZER => array(
						'enabled' => true,
						'chat_id' => '@studio_sales',
					),
				),
			)
		);

		$this->assertSame( array(), $validated['errors'] );
		$this->assertSame( '-1001234567890', $validated['settings']['organizers']['default']['chat_id'] );
	}

	/**
	 * Malformed destinations, a switch on without a destination and
	 * unknown organizer keys are refused by field.
	 *
	 * @return void
	 */
	public function test_rejects_invalid_input() {
		$validated = SaleAlertSettings::validate(
			array(
				'organizers' => array(
					'default'       => array(
						'enabled' => true,
						'chat_id' => '',
					),
					self::ORGANIZER => array(
						'enabled' => false,
						'chat_id' => 'https://t.me/x',
					),
					'central'       => array(
						'enabled' => true,
						'chat_id' => '123',
					),
				),
			)
		);

		$this->assertArrayHasKey( 'organizers.default.chat_id', $validated['errors'] );
		$this->assertArrayHasKey( 'organizers.' . self::ORGANIZER . '.chat_id', $validated['errors'] );
		$this->assertArrayHasKey( 'organizers', $validated['errors'] );
	}

	/**
	 * Saving keeps organizers that were not sent, and is stored without
	 * autoloading.
	 *
	 * @return void
	 */
	public function test_save_keeps_other_organizers() {
		SaleAlertSettings::save(
			array(
				'organizers' => array(
					self::ORGANIZER => array(
						'enabled' => true,
						'chat_id' => '@studio_sales',
					),
				),
			)
		);
		SaleAlertSettings::save(
			array(
				'organizers' => array(
					'default' => array(
						'enabled' => false,
						'chat_id' => '-100200',
					),
				),
			)
		);

		$saved = SaleAlertSettings::get();
		$this->assertArrayNotHasKey( 'enabled', $saved );
		$this->assertSame( '@studio_sales', $saved['organizers'][ self::ORGANIZER ]['chat_id'] );
		$this->assertFalse( $saved['organizers']['default']['enabled'] );
	}

	/**
	 * A stored switch without a readable destination is read as off.
	 *
	 * @return void
	 */
	public function test_sanitize_turns_off_organizers_without_destination() {
		$sanitized = SaleAlertSettings::sanitize(
			array(
				'enabled'    => 1,
				'organizers' => array(
					'default' => array(
						'enabled' => true,
						'chat_id' => 'not a chat',
					),
					'bogus'   => array(
						'enabled' => true,
						'chat_id' => '123',
					),
				),
			)
		);

		$this->assertArrayNotHasKey( 'enabled', $sanitized );
		$this->assertSame(
			array(
				'default' => array(
					'enabled'     => false,
					'chat_id'     => '',
					'frequency'   => 'immediate',
					'time_of_day' => '08:00',
					'day_of_week' => 1,
				),
			),
			$sanitized['organizers']
		);
	}

	/**
	 * Configurations saved before frequencies existed send immediately.
	 *
	 * @return void
	 */
	public function test_existing_organizers_default_to_immediate() {
		$GLOBALS['_fair_test_options'][ SaleAlertSettings::OPTION ] = array(
			'enabled'    => true,
			'organizers' => array(
				'default' => array(
					'enabled' => true,
					'chat_id' => '-100001',
				),
			),
		);

		$organizer = SaleAlertSettings::organizer( 'default' );
		$this->assertSame( 'immediate', $organizer['frequency'] );
		$this->assertTrue( $organizer['enabled'] );
		$this->assertFalse( SaleAlertSettings::is_digest( $organizer ) );
	}

	/**
	 * Daily and weekly digests save with their time and weekday.
	 *
	 * @return void
	 */
	public function test_validates_frequency_time_and_weekday() {
		$valid = SaleAlertSettings::validate(
			array(
				'organizers' => array(
					self::ORGANIZER => array(
						'enabled'     => true,
						'chat_id'     => '-100002',
						'frequency'   => 'weekly',
						'time_of_day' => '18:30',
						'day_of_week' => 5,
					),
				),
			)
		);
		$this->assertSame( array(), $valid['errors'] );
		SaleAlertSettings::save( $valid['settings'] );
		$saved = SaleAlertSettings::organizer( self::ORGANIZER );
		$this->assertSame( array( 'weekly', '18:30', 5 ), array( $saved['frequency'], $saved['time_of_day'], $saved['day_of_week'] ) );
		$this->assertTrue( SaleAlertSettings::is_digest( $saved ) );

		$invalid = SaleAlertSettings::validate(
			array(
				'organizers' => array(
					'default' => array(
						'enabled'     => false,
						'chat_id'     => '',
						'frequency'   => 'hourly',
						'time_of_day' => '25:00',
						'day_of_week' => 8,
					),
				),
			)
		);
		$this->assertSame(
			array( 'organizers.default.frequency', 'organizers.default.time_of_day', 'organizers.default.day_of_week' ),
			array_keys( $invalid['errors'] )
		);
	}

	/**
	 * Settings saved while the former sitewide switch was off keep every
	 * organizer off, with its destination and schedule; the migration
	 * saves them without that switch, once.
	 *
	 * @return void
	 */
	public function test_legacy_switch_off_turns_every_organizer_off() {
		$GLOBALS['_fair_test_options'][ SaleAlertSettings::OPTION ] = array(
			'enabled'    => false,
			'organizers' => array(
				'default'       => array(
					'enabled' => true,
					'chat_id' => '-100001',
				),
				self::ORGANIZER => array(
					'enabled'     => true,
					'chat_id'     => '@studio_sales',
					'frequency'   => 'weekly',
					'time_of_day' => '18:30',
					'day_of_week' => 5,
				),
			),
		);

		$this->assertFalse( SaleAlertSettings::any_enabled() );
		$this->assertTrue( SaleAlertSettings::migrate() );

		$stored = $GLOBALS['_fair_test_options'][ SaleAlertSettings::OPTION ];
		$this->assertArrayNotHasKey( 'enabled', $stored );
		$this->assertSame(
			array(
				'enabled'     => false,
				'chat_id'     => '@studio_sales',
				'frequency'   => 'weekly',
				'time_of_day' => '18:30',
				'day_of_week' => 5,
			),
			$stored['organizers'][ self::ORGANIZER ]
		);
		$this->assertFalse( $stored['organizers']['default']['enabled'] );
		$this->assertSame( '-100001', $stored['organizers']['default']['chat_id'] );

		// Once migrated, an organizer turned back on stays on.
		$this->assertFalse( SaleAlertSettings::migrate() );
		SaleAlertSettings::save(
			array(
				'organizers' => array(
					'default' => array_merge( $stored['organizers']['default'], array( 'enabled' => true ) ),
				),
			)
		);
		$this->assertTrue( SaleAlertSettings::organizer( 'default' )['enabled'] );
		$this->assertFalse( SaleAlertSettings::organizer( self::ORGANIZER )['enabled'] );
	}

	/**
	 * Settings saved while the former sitewide switch was on keep each
	 * organizer's own switch.
	 *
	 * @return void
	 */
	public function test_legacy_switch_on_keeps_organizer_switches() {
		$GLOBALS['_fair_test_options'][ SaleAlertSettings::OPTION ] = array(
			'enabled'    => true,
			'organizers' => array(
				'default'       => array(
					'enabled' => true,
					'chat_id' => '-100001',
				),
				self::ORGANIZER => array(
					'enabled' => false,
					'chat_id' => '@studio_sales',
				),
			),
		);

		$this->assertTrue( SaleAlertSettings::migrate() );
		$stored = $GLOBALS['_fair_test_options'][ SaleAlertSettings::OPTION ];
		$this->assertArrayNotHasKey( 'enabled', $stored );
		$this->assertTrue( $stored['organizers']['default']['enabled'] );
		$this->assertFalse( $stored['organizers'][ self::ORGANIZER ]['enabled'] );
		$this->assertTrue( SaleAlertSettings::any_enabled() );
	}

	/**
	 * A site that never saved ticket sale alerts has nothing to migrate.
	 *
	 * @return void
	 */
	public function test_fresh_site_has_nothing_to_migrate() {
		$this->assertFalse( SaleAlertSettings::migrate() );
		$this->assertArrayNotHasKey( SaleAlertSettings::OPTION, $GLOBALS['_fair_test_options'] );
		$this->assertFalse( SaleAlertSettings::any_enabled() );
	}
}
