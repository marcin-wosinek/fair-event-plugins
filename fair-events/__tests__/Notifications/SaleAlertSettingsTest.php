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
		$this->assertFalse( SaleAlertSettings::enabled() );
		$this->assertSame( array(), SaleAlertSettings::get()['organizers'] );
		$this->assertSame(
			array(
				'enabled' => false,
				'chat_id' => '',
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
				'enabled'    => true,
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
				'enabled'    => 'yes',
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

		$this->assertArrayHasKey( 'enabled', $validated['errors'] );
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
				'enabled'    => true,
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
				'enabled'    => true,
				'organizers' => array(
					'default' => array(
						'enabled' => false,
						'chat_id' => '-100200',
					),
				),
			)
		);

		$saved = SaleAlertSettings::get();
		$this->assertTrue( $saved['enabled'] );
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

		$this->assertFalse( $sanitized['enabled'] );
		$this->assertSame(
			array(
				'default' => array(
					'enabled' => false,
					'chat_id' => '',
				),
			),
			$sanitized['organizers']
		);
	}
}
