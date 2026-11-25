<?php
/**
 * WhatsApp Connector credential tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WhatsApp;

use FairEventsExperimental\WhatsApp\Connector;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Covers precedence, fallthrough, trimming, absence and secret-free status
 * for the access token and both webhook credentials.
 */
class ConnectorTest extends TestCase {
	private const SAVED    = 'synthetic-saved-whatsapp-credential';
	private const CONSTANT = 'synthetic-constant-whatsapp-credential';
	private const ENV      = 'synthetic-env-whatsapp-credential';

	/**
	 * Start with nothing saved and no override.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		self::clear_env();
	}

	/**
	 * Clear the environment overrides.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		self::clear_env();
	}

	/**
	 * Unset every override environment variable.
	 *
	 * @return void
	 */
	private static function clear_env() {
		putenv( Connector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		foreach ( Connector::WEBHOOK as $names ) {
			putenv( $names['name'] ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		}
	}

	/**
	 * Webhook credential kinds.
	 *
	 * @return array<string, array{0: string}>
	 */
	public static function kinds() {
		return array(
			'app secret'   => array( 'app_secret' ),
			'verify token' => array( 'verify_token' ),
		);
	}

	/**
	 * The webhook credential's environment variable wins over its constant,
	 * which wins over the saved option; removing the overrides returns the
	 * saved value, untouched.
	 *
	 * @param string $kind Credential kind.
	 */
	#[DataProvider( 'kinds' )]
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_webhook_precedence( $kind ) {
		$names = Connector::WEBHOOK[ $kind ];
		$GLOBALS['_fair_test_options'][ $names['option'] ] = self::SAVED;
		$this->assertSame(
			array(
				'token'  => self::SAVED,
				'source' => 'database',
			),
			Connector::webhook_credential( $kind )
		);

		define( $names['name'], ' ' . self::CONSTANT . ' ' );
		$this->assertSame(
			array(
				'token'  => self::CONSTANT,
				'source' => 'constant',
			),
			Connector::webhook_credential( $kind )
		);

		putenv( $names['name'] . '=' . self::ENV ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$this->assertSame(
			array(
				'token'  => self::ENV,
				'source' => 'env',
			),
			Connector::webhook_credential( $kind )
		);

		putenv( $names['name'] ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$this->assertSame( 'constant', Connector::webhook_credential( $kind )['source'] );
		$this->assertSame( self::SAVED, $GLOBALS['_fair_test_options'][ $names['option'] ] );
	}

	/**
	 * Blank and non-string values fall through to the next source.
	 *
	 * @param string $kind Credential kind.
	 */
	#[DataProvider( 'kinds' )]
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_webhook_blank_values_fall_through( $kind ) {
		$names = Connector::WEBHOOK[ $kind ];
		define( $names['name'], array( self::CONSTANT ) );
		putenv( $names['name'] . '=  ' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.

		$GLOBALS['_fair_test_options'][ $names['option'] ] = "\t" . self::SAVED . "\n";
		$this->assertSame(
			array(
				'token'  => self::SAVED,
				'source' => 'database',
			),
			Connector::webhook_credential( $kind )
		);

		$GLOBALS['_fair_test_options'][ $names['option'] ] = '   ';
		$this->assertSame(
			array(
				'token'  => '',
				'source' => 'none',
			),
			Connector::webhook_credential( $kind )
		);
	}

	/** Webhook status has exact fields per kind and carries no credential. */
	public function test_webhook_status_fields_without_values() {
		$GLOBALS['_fair_test_options'][ Connector::WEBHOOK['app_secret']['option'] ] = self::SAVED;
		putenv( Connector::WEBHOOK['verify_token']['name'] . '=' . self::ENV ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.

		$status = Connector::webhook_status();
		$this->assertSame(
			array(
				'app_secret'   => array(
					'configured'    => true,
					'source'        => 'database',
					'override_name' => Connector::WEBHOOK['app_secret']['name'],
				),
				'verify_token' => array(
					'configured'    => true,
					'source'        => 'env',
					'override_name' => Connector::WEBHOOK['verify_token']['name'],
				),
			),
			$status
		);
		$encoded = (string) wp_json_encode( $status );
		$this->assertStringNotContainsString( self::SAVED, $encoded );
		$this->assertStringNotContainsString( self::ENV, $encoded );
	}

	/** Nothing configured is reported for every credential. */
	public function test_absent_credentials() {
		$this->assertSame(
			array(
				'configured' => false,
				'source'     => 'none',
			),
			Connector::status()
		);
		foreach ( Connector::webhook_status() as $status ) {
			$this->assertFalse( $status['configured'] );
			$this->assertSame( 'none', $status['source'] );
		}
	}

	/** Saving and deleting a webhook credential keeps its option behavior. */
	public function test_save_and_delete_webhook_credential() {
		Connector::save_webhook_credential( 'verify_token', self::SAVED );
		$this->assertSame( 'database', Connector::webhook_credential( 'verify_token' )['source'] );

		Connector::save_webhook_credential( 'verify_token', '' );
		$this->assertArrayNotHasKey( Connector::WEBHOOK['verify_token']['option'], $GLOBALS['_fair_test_options'] );
		$this->assertSame( 'none', Connector::webhook_credential( 'verify_token' )['source'] );
	}

	/** The access token status carries no credential, with every source set. */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_access_token_precedence_and_status() {
		$GLOBALS['_fair_test_options'][ Connector::TOKEN_OPTION ] = self::SAVED;
		define( Connector::CREDENTIAL_NAME, self::CONSTANT );
		putenv( Connector::CREDENTIAL_NAME . '=' . self::ENV ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.

		$this->assertSame( self::ENV, Connector::token() );
		$status = Connector::status();
		$this->assertSame(
			array(
				'configured' => true,
				'source'     => 'env',
			),
			$status
		);
		$encoded = (string) wp_json_encode( $status );
		foreach ( array( self::SAVED, self::CONSTANT, self::ENV ) as $value ) {
			$this->assertStringNotContainsString( $value, $encoded );
		}
	}
}
