<?php
/**
 * NotificationSettings tests
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Settings;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Settings\NotificationSettings;

/**
 * Routes and Telegram settings saved by the experimental plugin keep working.
 */
class NotificationSettingsTest extends TestCase {

	/**
	 * Settings under test.
	 *
	 * @var NotificationSettings
	 */
	private $settings;

	/**
	 * Reset options.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		$this->settings                = new NotificationSettings();
	}

	/**
	 * The option names are the ones the experimental plugin stored.
	 */
	public function test_uses_the_existing_option_names() {
		$this->assertSame( 'fair_payment_notification_routes', NotificationSettings::ROUTES_OPTION );
		$this->assertSame( 'fair_payment_telegram_bot_token', NotificationSettings::BOT_TOKEN_OPTION );
	}

	/**
	 * Configured routes are never overwritten by the legacy migration.
	 */
	public function test_existing_routes_are_not_migrated_again() {
		$routes = array(
			array(
				'id'          => 'route-a',
				'enabled'     => false,
				'channel'     => 'email',
				'destination' => 'owner@example.test',
				'frequency'   => 'weekly',
				'include_pii' => false,
			),
		);
		$GLOBALS['_fair_test_options'][ NotificationSettings::ROUTES_OPTION ] = $routes;
		$GLOBALS['_fair_test_options']['fair_payment_telegram_enabled']       = true;
		$GLOBALS['_fair_test_options']['fair_payment_telegram_chat_ids']      = '123';

		$this->settings->maybe_migrate_legacy_settings();

		$this->assertSame( $routes, $GLOBALS['_fair_test_options'][ NotificationSettings::ROUTES_OPTION ] );
	}

	/**
	 * Legacy flat Telegram settings become one immediate route per chat.
	 */
	public function test_legacy_telegram_settings_become_immediate_routes() {
		$GLOBALS['_fair_test_options']['fair_payment_telegram_enabled']     = true;
		$GLOBALS['_fair_test_options']['fair_payment_telegram_chat_ids']    = '123, @sales';
		$GLOBALS['_fair_test_options']['fair_payment_telegram_include_pii'] = false;

		$this->settings->maybe_migrate_legacy_settings();

		$routes = $GLOBALS['_fair_test_options'][ NotificationSettings::ROUTES_OPTION ];
		$this->assertSame( array( '123', '@sales' ), array_column( $routes, 'destination' ) );
		foreach ( $routes as $route ) {
			$this->assertTrue( $route['enabled'] );
			$this->assertSame( 'telegram', $route['channel'] );
			$this->assertSame( 'immediate', $route['frequency'] );
			$this->assertFalse( $route['include_pii'] );
		}
	}

	/**
	 * Without legacy settings the routes start empty.
	 */
	public function test_no_legacy_settings_starts_with_no_routes() {
		$this->settings->maybe_migrate_legacy_settings();

		$this->assertSame( array(), $GLOBALS['_fair_test_options'][ NotificationSettings::ROUTES_OPTION ] );
	}

	/**
	 * Saving keeps each route's enabled state, destination, frequency and
	 * personal-information preference, and drops invalid entries.
	 */
	public function test_sanitize_routes_preserves_route_fields() {
		$sanitized = $this->settings->sanitize_routes(
			array(
				array(
					'id'          => 'route-a',
					'enabled'     => false,
					'channel'     => 'telegram',
					'destination' => '123 456',
					'frequency'   => 'hourly',
					'include_pii' => false,
				),
				array(
					'id'          => 'route-b',
					'enabled'     => true,
					'channel'     => 'email',
					'destination' => 'owner@example.test',
					'frequency'   => 'daily',
				),
				array(
					'channel'     => 'sms',
					'destination' => '123',
				),
				array(
					'channel'     => 'email',
					'destination' => 'owner@example.test',
					'frequency'   => 'monthly',
				),
			)
		);

		$this->assertSame(
			array(
				array(
					'id'          => 'route-a',
					'enabled'     => false,
					'channel'     => 'telegram',
					'destination' => '123, 456',
					'frequency'   => 'hourly',
					'include_pii' => false,
				),
				array(
					'id'          => 'route-b',
					'enabled'     => true,
					'channel'     => 'email',
					'destination' => 'owner@example.test',
					'frequency'   => 'daily',
					'include_pii' => true,
				),
			),
			$sanitized
		);
	}
}
