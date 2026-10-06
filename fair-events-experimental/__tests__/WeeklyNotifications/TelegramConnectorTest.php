<?php
/**
 * TelegramConnector unit tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WeeklyNotifications;

use FairEventsExperimental\Settings\WeeklyNotificationSettings;
use FairEventsExperimental\WeeklyNotifications\TelegramConnector;
use PHPUnit\Framework\TestCase;

/**
 * Tests credential resolution, source precedence and write validation.
 */
class TelegramConnectorTest extends TestCase {
	private const SAVED    = '123456789:AAEabcdefghijklmnopqrstuvwxyz012345';
	private const OVERRIDE = '987654321:AAEzyxwvutsrqponmlkjihgfedcba543210';

	/**
	 * Start with no credential anywhere.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		putenv( TelegramConnector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/**
	 * Clear the environment override.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		putenv( TelegramConnector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/**
	 * Save a token the way the plugin stored it before Connectors.
	 *
	 * @param string $token Token.
	 * @return void
	 */
	private static function save( $token ) {
		$GLOBALS['_fair_test_options'][ WeeklyNotificationSettings::TOKEN_OPTION ] = $token;
	}

	/** A token saved before the move is the connector's database credential. */
	public function test_pre_upgrade_token_is_used_without_migration() {
		self::save( self::SAVED );

		$this->assertSame(
			array(
				'token'  => self::SAVED,
				'source' => 'database',
			),
			TelegramConnector::credential()
		);
		$this->assertSame(
			array(
				'configured' => true,
				'valid'      => true,
				'source'     => 'database',
			),
			TelegramConnector::status()
		);
		$this->assertNull( TelegramConnector::problem() );
	}

	/** Nothing configured is reported as missing. */
	public function test_missing_credential() {
		$this->assertSame( '', TelegramConnector::token() );
		$this->assertSame( 'none', TelegramConnector::status()['source'] );
		$this->assertFalse( TelegramConnector::status()['configured'] );
		$this->assertSame( 'missing_token', TelegramConnector::problem()['code'] );
	}

	/** Replacing and removing the saved token takes effect on the next read. */
	public function test_runtime_replacement_and_removal() {
		self::save( self::SAVED );
		$this->assertSame( self::SAVED, TelegramConnector::token() );

		self::save( self::OVERRIDE );
		$this->assertSame( self::OVERRIDE, TelegramConnector::token() );

		self::save( '' );
		$this->assertSame( 'none', TelegramConnector::credential()['source'] );
	}

	/** The environment variable overrides the saved token. */
	public function test_environment_variable_overrides_the_database() {
		self::save( self::SAVED );
		putenv( TelegramConnector::CREDENTIAL_NAME . '=' . self::OVERRIDE ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.

		$this->assertSame(
			array(
				'token'  => self::OVERRIDE,
				'source' => 'env',
			),
			TelegramConnector::credential()
		);
	}

	/**
	 * The constant overrides the saved token, and the environment variable overrides the constant.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 */
	public function test_constant_sits_between_environment_and_database() {
		self::save( self::SAVED );
		define( TelegramConnector::CREDENTIAL_NAME, self::OVERRIDE );

		$this->assertSame(
			array(
				'token'  => self::OVERRIDE,
				'source' => 'constant',
			),
			TelegramConnector::credential()
		);

		putenv( TelegramConnector::CREDENTIAL_NAME . '=' . self::SAVED ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$this->assertSame( 'env', TelegramConnector::credential()['source'] );
	}

	/** A malformed credential is configured but unusable, and is never echoed. */
	public function test_malformed_credential_is_reported_without_its_value() {
		self::save( 'not-a-bot-token' );

		$this->assertSame(
			array(
				'configured' => true,
				'valid'      => false,
				'source'     => 'database',
			),
			TelegramConnector::status()
		);
		$problem = TelegramConnector::problem();
		$this->assertSame( 'invalid_token', $problem['code'] );
		$this->assertStringNotContainsString( 'not-a-bot-token', $problem['message'] );

		putenv( TelegramConnector::CREDENTIAL_NAME . '=env-not-a-token' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$problem = TelegramConnector::problem();
		$this->assertSame( 'invalid_token', $problem['code'] );
		$this->assertStringContainsString( TelegramConnector::CREDENTIAL_NAME, $problem['message'] );
		$this->assertStringNotContainsString( 'env-not-a-token', $problem['message'] );
	}

	/** Writes accept a well-formed token or removal, and keep the saved token otherwise. */
	public function test_sanitize_keeps_the_saved_token_for_a_malformed_replacement() {
		self::save( self::SAVED );

		$this->assertSame( self::OVERRIDE, TelegramConnector::sanitize_credential( ' ' . self::OVERRIDE . ' ' ) );
		$this->assertSame( '', TelegramConnector::sanitize_credential( '' ) );
		$this->assertSame( self::SAVED, TelegramConnector::sanitize_credential( 'not-a-bot-token' ) );
		$this->assertSame( '', TelegramConnector::sanitize_credential( array( self::OVERRIDE ) ) );
	}

	/** A newly saved credential is never autoloaded; other options are untouched. */
	public function test_credential_option_is_not_autoloaded() {
		$this->assertFalse( TelegramConnector::autoload( null, WeeklyNotificationSettings::TOKEN_OPTION ) );
		$this->assertNull( TelegramConnector::autoload( null, 'another_option' ) );
	}
}
