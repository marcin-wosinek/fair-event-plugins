<?php
/**
 * WeeklyNotificationSettings unit tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WeeklyNotifications;

use FairEventsExperimental\Settings\WeeklyNotificationSettings;
use PHPUnit\Framework\TestCase;

/**
 * Tests settings validation.
 */
class WeeklyNotificationSettingsTest extends TestCase {

	/**
	 * Reset options.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/** Defaults send on Monday at 09:00 for the current week, with Telegram off. */
	public function test_defaults() {
		$settings = WeeklyNotificationSettings::get();

		$this->assertFalse( $settings['enabled'] );
		$this->assertSame( 1, $settings['day_of_week'] );
		$this->assertSame( '09:00', $settings['time_of_day'] );
		$this->assertSame( 'current', $settings['week_scope'] );
		$this->assertFalse( $settings['providers']['telegram']['enabled'] );
	}

	/** Invalid stored values fall back to defaults. */
	public function test_normalize_rejects_invalid_values() {
		$settings = WeeklyNotificationSettings::normalize(
			array(
				'day_of_week' => 9,
				'time_of_day' => '25:00',
				'week_scope'  => 'last',
				'page_id'     => -3,
			)
		);

		$this->assertSame( 1, $settings['day_of_week'] );
		$this->assertSame( '09:00', $settings['time_of_day'] );
		$this->assertSame( 'current', $settings['week_scope'] );
		$this->assertSame( 0, $settings['page_id'] );
	}

	/** Disabling Telegram keeps its destinations. */
	public function test_disabling_telegram_keeps_its_configuration() {
		WeeklyNotificationSettings::save(
			array(
				'providers' => array(
					'telegram' => array(
						'enabled'  => false,
						'chat_ids' => array( '@fair_channel' ),
					),
				),
			)
		);

		$this->assertSame( array( '@fair_channel' ), WeeklyNotificationSettings::get()['providers']['telegram']['chat_ids'] );
	}

	/** The settings never include the bot token. */
	public function test_settings_never_include_the_token() {
		$GLOBALS['_fair_test_options'][ WeeklyNotificationSettings::TOKEN_OPTION ] = '123456789:AAEabcdefghijklmnopqrstuvwxyz012345';

		$this->assertStringNotContainsString( 'AAEabcdefghijklmnopqrstuvwxyz012345', json_encode( WeeklyNotificationSettings::get() ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode
	}

	/** Chat IDs are numeric IDs or @usernames. */
	public function test_chat_id_validation() {
		foreach ( array( '123456', '-1001234567890', '@fair_channel' ) as $valid ) {
			$this->assertTrue( WeeklyNotificationSettings::valid_chat_id( $valid ), $valid );
		}
		foreach ( array( '', 'channel', '@ab', '@1abc', 'https://t.me/x', '12 34' ) as $invalid ) {
			$this->assertFalse( WeeklyNotificationSettings::valid_chat_id( $invalid ), $invalid );
		}
	}

	/** Chat IDs typed as text are split and de-duplicated. */
	public function test_parse_chat_ids() {
		$this->assertSame(
			array( '@one', '-100200', '@two' ),
			WeeklyNotificationSettings::parse_chat_ids( "@one, -100200\n@two @one" )
		);
	}

	/** Bot tokens must have Telegram's shape. */
	public function test_token_validation() {
		$this->assertTrue( WeeklyNotificationSettings::valid_token( '123456789:AAEabcdefghijklmnopqrstuvwxyz012345' ) );
		$this->assertFalse( WeeklyNotificationSettings::valid_token( 'not a token' ) );
		$this->assertFalse( WeeklyNotificationSettings::valid_token( '123456789:short' ) );
	}

	/** Times must be 24-hour HH:MM. */
	public function test_time_validation() {
		$this->assertTrue( WeeklyNotificationSettings::valid_time( '00:00' ) );
		$this->assertTrue( WeeklyNotificationSettings::valid_time( '23:59' ) );
		$this->assertFalse( WeeklyNotificationSettings::valid_time( '9:00' ) );
		$this->assertFalse( WeeklyNotificationSettings::valid_time( '24:00' ) );
	}
}
