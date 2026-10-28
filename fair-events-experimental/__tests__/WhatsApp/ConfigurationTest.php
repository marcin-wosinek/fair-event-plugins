<?php
/**
 * WhatsApp configuration and connector tests.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\WhatsApp;

use FairEventsExperimental\WhatsApp\Configuration;
use FairEventsExperimental\WhatsApp\Connector;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Covers credential precedence, separation from the Meta Conversions token,
 * and when a validation result stops applying.
 */
class ConfigurationTest extends TestCase {
	private const SAVED    = 'EAAGsavedWhatsAppToken0123456789abcdef';
	private const OVERRIDE = 'EAAGoverrideWhatsAppToken9876543210zyx';
	private const SENDER   = array(
		'display_phone_number' => '+34 600 000 002',
		'verified_name'        => 'Fair Events',
		'quality_rating'       => 'GREEN',
	);

	/** Start with nothing saved and no override. */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		putenv( Connector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/** Clear the environment override. */
	protected function tearDown(): void {
		putenv( Connector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/**
	 * Save a token as Connectors does.
	 *
	 * @param string $token Token.
	 * @return void
	 */
	private static function save_token( $token ) {
		$GLOBALS['_fair_test_options'][ Connector::TOKEN_OPTION ] = $token;
	}

	/** Save IDs and validate them with the saved token. */
	private static function validated() {
		self::save_token( self::SAVED );
		Configuration::save( '100000000000001', '200000000000002' );
		Configuration::record_validation( self::SENDER );
	}

	/** The WhatsApp token is its own credential, not the Meta Conversions one. */
	public function test_token_is_separate_from_meta_conversions() {
		$GLOBALS['_fair_test_options']['fair_events_experimental_meta_access_token'] = self::SAVED;

		$this->assertSame( 'none', Connector::credential()['source'] );
		$this->assertNotSame( 'FAIR_EVENTS_EXPERIMENTAL_META_ACCESS_TOKEN', Connector::CREDENTIAL_NAME );
	}

	/** Saving, replacing and removing the token take effect on the next read. */
	public function test_saved_token_replacement_and_removal() {
		self::save_token( self::SAVED );
		$this->assertSame(
			array(
				'token'  => self::SAVED,
				'source' => 'database',
			),
			Connector::credential()
		);

		self::save_token( self::OVERRIDE );
		$this->assertSame( self::OVERRIDE, Connector::token() );

		self::save_token( '' );
		$this->assertSame(
			array(
				'configured' => false,
				'source'     => 'none',
			),
			Connector::status()
		);
	}

	/** The environment variable overrides the saved token. */
	public function test_environment_overrides_the_saved_token() {
		self::save_token( self::SAVED );
		putenv( Connector::CREDENTIAL_NAME . '=' . self::OVERRIDE ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.

		$this->assertSame(
			array(
				'token'  => self::OVERRIDE,
				'source' => 'env',
			),
			Connector::credential()
		);
	}

	/** The constant sits between the environment and the saved token. */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_constant_sits_between_environment_and_database() {
		self::save_token( self::SAVED );
		define( Connector::CREDENTIAL_NAME, self::OVERRIDE );
		$this->assertSame( 'constant', Connector::credential()['source'] );

		putenv( Connector::CREDENTIAL_NAME . '=' . self::SAVED ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$this->assertSame( 'env', Connector::credential()['source'] );
	}

	/** Malformed tokens keep the saved one; empty removes it. */
	public function test_sanitize_credential() {
		self::save_token( self::SAVED );

		$this->assertSame( self::OVERRIDE, Connector::sanitize_credential( ' ' . self::OVERRIDE . ' ' ) );
		$this->assertSame( '', Connector::sanitize_credential( '' ) );
		$this->assertSame( self::SAVED, Connector::sanitize_credential( 'not a token' ) );
		$this->assertFalse( Connector::autoload( null, Connector::TOKEN_OPTION ) );
	}

	/** IDs are digit strings. */
	public function test_valid_id() {
		$this->assertTrue( Configuration::valid_id( '100000000000001' ) );
		$this->assertFalse( Configuration::valid_id( '+34 600 000 002' ) );
		$this->assertFalse( Configuration::valid_id( '' ) );
		$this->assertFalse( Configuration::valid_id( 100000000000001 ) );
	}

	/** A validation applies to the IDs and token it was made with, and stores no token. */
	public function test_validation_applies_while_nothing_changed() {
		self::validated();

		$validation = Configuration::validation();
		$this->assertSame( self::SENDER, $validation['sender'] );
		$this->assertSame( '2026-01-01 00:00:00', $validation['validated_at'] );
		$this->assertStringNotContainsString( self::SAVED, (string) wp_json_encode( $GLOBALS['_fair_test_options'][ Configuration::VALIDATION_OPTION ] ) );
	}

	/** Saving the same IDs again keeps the validation. */
	public function test_saving_unchanged_ids_keeps_the_validation() {
		self::validated();
		Configuration::save( '100000000000001', '200000000000002' );

		$this->assertNotNull( Configuration::validation() );
	}

	/** Changed IDs clear the validation. */
	public function test_changed_ids_clear_the_validation() {
		self::validated();
		Configuration::save( '100000000000001', '200000000000003' );

		$this->assertNull( Configuration::validation() );
		$this->assertArrayNotHasKey( Configuration::VALIDATION_OPTION, $GLOBALS['_fair_test_options'] );

		// Changing back does not bring it back.
		Configuration::save( '100000000000001', '200000000000002' );
		$this->assertNull( Configuration::validation() );
	}

	/** A replaced, overridden or removed token no longer matches the validation. */
	public function test_token_changes_invalidate_the_validation() {
		self::validated();

		self::save_token( self::OVERRIDE );
		$this->assertNull( Configuration::validation() );

		self::save_token( self::SAVED );
		$this->assertNotNull( Configuration::validation() );

		putenv( Connector::CREDENTIAL_NAME . '=' . self::OVERRIDE ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$this->assertNull( Configuration::validation() );
		putenv( Connector::CREDENTIAL_NAME ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.

		self::save_token( '' );
		$this->assertNull( Configuration::validation() );
	}
}
