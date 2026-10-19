<?php
/**
 * Meta Connector unit tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Connector;
use FairEventsExperimental\Meta\Conversions;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;

/**
 * Tests credential resolution, source precedence, write validation and the
 * delivery path's use of the resolved credential.
 */
class ConnectorTest extends TestCase {
	private const SAVED    = 'EAAGsavedMetaAccessToken0123456789abcdef';
	private const OVERRIDE = 'EAAGoverrideMetaAccessToken9876543210zyx';

	/**
	 * Start with no credential anywhere.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options']              = array();
		$GLOBALS['_fair_test_remote_post_requests'] = array();
		putenv( Connector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/**
	 * Clear the environment override.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		putenv( Connector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		unset( $GLOBALS['_fair_test_remote_post_response'] );
	}

	/**
	 * Save a token the way the plugin stored it before Connectors.
	 *
	 * @param string $token Token.
	 * @return void
	 */
	private static function save( $token ) {
		$GLOBALS['_fair_test_options'][ Conversions::TOKEN_OPTION ] = $token;
	}

	/** A token saved before the move is the connector's database credential. */
	public function test_pre_upgrade_token_is_used_without_migration() {
		self::save( self::SAVED );

		$this->assertSame(
			array(
				'token'  => self::SAVED,
				'source' => 'database',
			),
			Connector::credential()
		);
		$this->assertSame(
			array(
				'configured' => true,
				'source'     => 'database',
			),
			Connector::status()
		);
	}

	/** A token saved before the move is not reformatted or validated away. */
	public function test_pre_upgrade_short_token_keeps_working() {
		self::save( 'legacy-token' );

		$this->assertSame( 'legacy-token', Connector::token() );
		$this->assertTrue( Connector::status()['configured'] );
	}

	/** Nothing configured is reported as missing. */
	public function test_missing_credential() {
		$this->assertSame( '', Connector::token() );
		$this->assertSame(
			array(
				'configured' => false,
				'source'     => 'none',
			),
			Connector::status()
		);
	}

	/** Replacing and removing the saved token takes effect on the next read. */
	public function test_runtime_replacement_and_removal() {
		self::save( self::SAVED );
		$this->assertSame( self::SAVED, Connector::token() );

		self::save( self::OVERRIDE );
		$this->assertSame( self::OVERRIDE, Connector::token() );

		self::save( '' );
		$this->assertSame( 'none', Connector::credential()['source'] );
	}

	/** The environment variable overrides the saved token, and survives its removal. */
	public function test_environment_variable_overrides_the_database() {
		self::save( self::SAVED );
		putenv( Connector::CREDENTIAL_NAME . '=' . self::OVERRIDE ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.

		$this->assertSame(
			array(
				'token'  => self::OVERRIDE,
				'source' => 'env',
			),
			Connector::credential()
		);

		self::save( '' );
		$this->assertSame(
			array(
				'configured' => true,
				'source'     => 'env',
			),
			Connector::status()
		);
	}

	/**
	 * The constant overrides the saved token, and the environment variable overrides the constant.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_constant_sits_between_environment_and_database() {
		self::save( self::SAVED );
		define( Connector::CREDENTIAL_NAME, self::OVERRIDE );

		$this->assertSame(
			array(
				'token'  => self::OVERRIDE,
				'source' => 'constant',
			),
			Connector::credential()
		);

		putenv( Connector::CREDENTIAL_NAME . '=' . self::SAVED ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$this->assertSame( 'env', Connector::credential()['source'] );
	}

	/** Validation is local and loose: no prefix, but no whitespace, masks or fragments. */
	public function test_valid_token() {
		$this->assertTrue( Connector::valid_token( self::SAVED ) );
		$this->assertTrue( Connector::valid_token( 'not-starting-with-EAA-but-long-enough' ) );
		$this->assertFalse( Connector::valid_token( 'short' ) );
		$this->assertFalse( Connector::valid_token( 'has a space in the middle of it' ) );
		$this->assertFalse( Connector::valid_token( str_repeat( "\u{2022}", 16 ) . 'cdef' ) );
		$this->assertFalse( Connector::valid_token( array( self::SAVED ) ) );
	}

	/** Writes accept a valid token or removal, and keep the saved token otherwise. */
	public function test_sanitize_keeps_the_saved_token_for_a_malformed_replacement() {
		self::save( self::SAVED );

		$this->assertSame( self::OVERRIDE, Connector::sanitize_credential( ' ' . self::OVERRIDE . ' ' ) );
		$this->assertSame( '', Connector::sanitize_credential( '' ) );
		$this->assertSame( self::SAVED, Connector::sanitize_credential( 'not a token' ) );
		$this->assertSame( self::SAVED, Connector::sanitize_credential( str_repeat( "\u{2022}", 16 ) . 'cdef' ) );
		$this->assertSame( '', Connector::sanitize_credential( array( self::OVERRIDE ) ) );
	}

	/** A newly saved credential is never autoloaded; other options are untouched. */
	public function test_credential_option_is_not_autoloaded() {
		$this->assertFalse( Connector::autoload( null, Conversions::TOKEN_OPTION ) );
		$this->assertNull( Connector::autoload( null, 'another_option' ) );
	}

	/** Delivery is configured only with a dataset and a resolved credential. */
	public function test_configured_follows_the_connector_credential() {
		$GLOBALS['_fair_test_options'][ Conversions::DATASET_OPTION ] = '1234567890';
		$this->assertFalse( Conversions::configured() );

		putenv( Connector::CREDENTIAL_NAME . '=' . self::OVERRIDE ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$this->assertTrue( Conversions::configured() );
	}

	/** Production and test sends use the credential in effect, never echoing it back. */
	public function test_sends_use_the_resolved_credential() {
		self::save( self::SAVED );
		putenv( Connector::CREDENTIAL_NAME . '=' . self::OVERRIDE ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$GLOBALS['_fair_test_options'][ Conversions::DATASET_OPTION ]   = '1234567890';
		$GLOBALS['_fair_test_options'][ Conversions::TEST_CODE_OPTION ] = 'TEST123';

		$result = ( new Conversions() )->send_test( 'PageView' );

		$requests = $GLOBALS['_fair_test_remote_post_requests'];
		$this->assertCount( 1, $requests );
		$body = json_decode( $requests[0]['args']['body'], true );
		$this->assertSame( self::OVERRIDE, $body['access_token'] );
		$this->assertStringNotContainsString( self::OVERRIDE, (string) wp_json_encode( $result ) );
		$this->assertStringNotContainsString( self::OVERRIDE, (string) wp_json_encode( Conversions::test_history() ) );
	}
}
