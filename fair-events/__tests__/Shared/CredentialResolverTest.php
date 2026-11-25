<?php
/**
 * CredentialResolver unit tests.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Shared;

use FairEventsShared\Security\CredentialResolver;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Covers source precedence, fallthrough of unusable values, trimming,
 * absence and secret-free status.
 */
class CredentialResolverTest extends TestCase {
	private const ENV      = 'FAIR_EVENTS_TEST_RESOLVER_ENV';
	private const CONSTANT = 'FAIR_EVENTS_TEST_RESOLVER_CONSTANT';
	private const OPTION   = 'fair_events_test_resolver_option';

	private const ENV_VALUE      = 'synthetic-env-credential';
	private const CONSTANT_VALUE = 'synthetic-constant-credential';
	private const SAVED_VALUE    = 'synthetic-saved-credential';

	/**
	 * Start with no credential anywhere.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		putenv( self::ENV ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/**
	 * Clear the environment override.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		putenv( self::ENV ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/**
	 * Resolve with the test names.
	 *
	 * @return array{token: string, source: string}
	 */
	private static function resolve() {
		return CredentialResolver::resolve( self::ENV, self::CONSTANT, self::OPTION );
	}

	/**
	 * Set the environment override.
	 *
	 * @param string $value Value.
	 * @return void
	 */
	private static function set_env( $value ) {
		putenv( self::ENV . '=' . $value ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
	}

	/**
	 * The environment wins over the constant, which wins over the saved
	 * option; removing each override falls back to the next source and the
	 * saved value is never rewritten.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_precedence_across_all_three_sources() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = self::SAVED_VALUE;
		define( self::CONSTANT, self::CONSTANT_VALUE );
		self::set_env( self::ENV_VALUE );

		$this->assertSame(
			array(
				'token'  => self::ENV_VALUE,
				'source' => 'env',
			),
			self::resolve()
		);

		putenv( self::ENV ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$this->assertSame(
			array(
				'token'  => self::CONSTANT_VALUE,
				'source' => 'constant',
			),
			self::resolve()
		);
		$this->assertSame( self::SAVED_VALUE, $GLOBALS['_fair_test_options'][ self::OPTION ] );
	}

	/** The saved option is used when no override is set. */
	public function test_saved_option_without_overrides() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = self::SAVED_VALUE;

		$this->assertSame(
			array(
				'token'  => self::SAVED_VALUE,
				'source' => 'database',
			),
			self::resolve()
		);
	}

	/** Nothing configured anywhere. */
	public function test_absent_credential() {
		$this->assertSame(
			array(
				'token'  => '',
				'source' => 'none',
			),
			self::resolve()
		);
	}

	/** Every source is trimmed. */
	public function test_values_are_trimmed() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = "  \t" . self::SAVED_VALUE . "\n";
		$this->assertSame( self::SAVED_VALUE, self::resolve()['token'] );

		self::set_env( ' ' . self::ENV_VALUE . ' ' );
		$this->assertSame( self::ENV_VALUE, self::resolve()['token'] );
	}

	/**
	 * Unusable saved values.
	 *
	 * @return array<string, array{0: mixed}>
	 */
	public static function unusable_values() {
		return array(
			'empty'           => array( '' ),
			'whitespace only' => array( " \t\n " ),
			'false'           => array( false ),
			'integer'         => array( 12345 ),
			'array'           => array( array( self::SAVED_VALUE ) ),
			'null'            => array( null ),
		);
	}

	/**
	 * An unusable saved value reports no credential.
	 *
	 * @param mixed $value Saved value.
	 */
	#[DataProvider( 'unusable_values' )]
	public function test_unusable_saved_value_is_absent( $value ) {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = $value;

		$this->assertSame( 'none', self::resolve()['source'] );
		$this->assertSame( '', self::resolve()['token'] );
	}

	/** An empty or whitespace-only environment variable falls through to the saved option. */
	public function test_blank_environment_falls_through() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = self::SAVED_VALUE;

		self::set_env( '' );
		$this->assertSame( 'database', self::resolve()['source'] );

		self::set_env( '   ' );
		$this->assertSame( 'database', self::resolve()['source'] );
	}

	/** A whitespace-only constant falls through to the saved option. */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_blank_constant_falls_through() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = self::SAVED_VALUE;
		define( self::CONSTANT, '   ' );

		$this->assertSame( 'database', self::resolve()['source'] );
	}

	/** A non-string constant falls through to the saved option. */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_non_string_constant_falls_through() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = self::SAVED_VALUE;
		define( self::CONSTANT, 12345 );

		$this->assertSame( 'database', self::resolve()['source'] );
	}

	/** Empty names skip their source. */
	public function test_empty_names_skip_their_source() {
		self::set_env( self::ENV_VALUE );
		$GLOBALS['_fair_test_options'][ self::OPTION ] = self::SAVED_VALUE;

		$this->assertSame( 'database', CredentialResolver::resolve( '', '', self::OPTION )['source'] );
		$this->assertSame( 'env', CredentialResolver::resolve( self::ENV, '', '' )['source'] );
		putenv( self::ENV ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.runtime_configuration_putenv -- test-only environment.
		$this->assertSame( 'none', CredentialResolver::resolve( '', '', '' )['source'] );
	}

	/**
	 * Status carries exactly the configured flag and the source.
	 *
	 * @return array<string, array{0: string, 1: bool}>
	 */
	public static function sources() {
		return array(
			'env'      => array( 'env', true ),
			'constant' => array( 'constant', true ),
			'database' => array( 'database', true ),
			'none'     => array( 'none', false ),
		);
	}

	/**
	 * Status fields per source.
	 *
	 * @param string $source     Source.
	 * @param bool   $configured Expected configured flag.
	 */
	#[DataProvider( 'sources' )]
	public function test_status_fields( $source, $configured ) {
		$this->assertSame(
			array(
				'configured' => $configured,
				'source'     => $source,
			),
			CredentialResolver::status( $source )
		);
	}

	/** Status built from a resolution never carries the credential. */
	public function test_status_contains_no_credential() {
		self::set_env( self::ENV_VALUE );

		$status = CredentialResolver::status( self::resolve()['source'] );

		$this->assertStringNotContainsString( self::ENV_VALUE, (string) json_encode( $status ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- test-only.
	}
}
