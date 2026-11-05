<?php
/**
 * Tests for the vendored FairEventsShared\FeatureFlags.
 *
 * Lives here because this plugin's bootstrap stubs apply_filters() with its
 * extra arguments, so the filter's key argument can be asserted, and it tests
 * the copy bundled through this plugin's production autoloader.
 *
 * @package FairPaymentsConnector
 */

namespace FairEventsShared\Tests;

use FairEventsShared\FeatureFlags;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Resolution, forced-state, and sanitization rules of the shared resolver.
 */
class FeatureFlagsTest extends TestCase {

	private const OPTION = 'fair_test_flags';
	private const FILTER = 'fair_test_flag_enabled';

	/**
	 * Reset the option store and filter registry.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		$GLOBALS['_fair_test_filters'] = array();
	}

	/**
	 * Clear fixtures so later tests in this process start clean.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['_fair_test_options'] = array();
		$GLOBALS['_fair_test_filters'] = array();
	}

	/**
	 * Resolver with a representative registry.
	 *
	 * @param string $prefix Per-feature constant prefix.
	 * @param string $master Master constant name.
	 * @param string $option Option name.
	 * @param string $filter Filter name.
	 * @return FeatureFlags
	 */
	private function flags( $prefix = 'FAIR_TEST_FEATURE_', $master = 'FAIR_TEST_INTERNAL', $option = self::OPTION, $filter = self::FILTER ) {
		return new FeatureFlags(
			array(
				'core'                 => array(
					'default'   => true,
					'always_on' => true,
				),
				'bundled-translations' => array( 'default' => false ),
				'ticketing'            => array( 'default' => true ),
			),
			$option,
			$prefix,
			$master,
			$filter
		);
	}

	/**
	 * Defaults apply when nothing is stored, and nothing is forced.
	 *
	 * @return void
	 */
	public function test_defaults_apply_without_stored_values() {
		$flags = $this->flags();

		$this->assertFalse( $flags->is_enabled( 'bundled-translations' ) );
		$this->assertTrue( $flags->is_enabled( 'ticketing' ) );
		$this->assertFalse( $flags->is_forced( 'bundled-translations' ) );
		$this->assertFalse( $flags->is_forced( 'ticketing' ) );
	}

	/**
	 * Stored values win over defaults, Boolean-cast, including explicit
	 * false and null.
	 *
	 * @return void
	 */
	public function test_stored_values_override_defaults() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = array(
			'bundled-translations' => 1,
			'ticketing'            => null,
		);
		$flags = $this->flags();

		$this->assertTrue( $flags->is_enabled( 'bundled-translations' ) );
		$this->assertFalse( $flags->is_enabled( 'ticketing' ) );

		$GLOBALS['_fair_test_options'][ self::OPTION ] = array( 'ticketing' => false );
		$this->assertFalse( $flags->is_enabled( 'ticketing' ) );
	}

	/**
	 * A malformed stored option falls back to defaults.
	 *
	 * @return void
	 */
	public function test_malformed_stored_option_falls_back_to_defaults() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = 'garbage';
		$flags = $this->flags();

		$this->assertFalse( $flags->is_enabled( 'bundled-translations' ) );
		$this->assertTrue( $flags->is_enabled( 'ticketing' ) );
	}

	/**
	 * Unknown keys are disabled and unforced, even when stored or filtered.
	 *
	 * @return void
	 */
	public function test_unknown_keys_are_disabled_and_unforced() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = array( 'nope' => true );
		$GLOBALS['_fair_test_filters'][ self::FILTER ] = static function () {
			return true;
		};
		$flags = $this->flags();

		$this->assertFalse( $flags->is_enabled( 'nope' ) );
		$this->assertFalse( $flags->is_forced( 'nope' ) );
	}

	/**
	 * Always-on entries are enabled and forced; the filter cannot disable
	 * them and stored false is ignored.
	 *
	 * @return void
	 */
	public function test_always_on_bypasses_stored_values_and_filter() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = array( 'core' => false );
		$GLOBALS['_fair_test_filters'][ self::FILTER ] = static function () {
			return false;
		};
		$flags = $this->flags();

		$this->assertTrue( $flags->is_enabled( 'core' ) );
		$this->assertTrue( $flags->is_forced( 'core' ) );
	}

	/**
	 * The filter receives the stored/default result and the key, and its
	 * Boolean-cast return wins.
	 *
	 * @return void
	 */
	public function test_filter_receives_value_and_key_and_wins() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = array( 'ticketing' => false );
		$calls = array();
		$GLOBALS['_fair_test_filters'][ self::FILTER ] = static function ( $enabled, $key ) use ( &$calls ) {
			$calls[] = array( $enabled, $key );
			return 'yes';
		};
		$flags = $this->flags();

		$this->assertTrue( $flags->is_enabled( 'ticketing' ) );
		$this->assertSame( array( array( false, 'ticketing' ) ), $calls );
		$this->assertFalse( $flags->is_forced( 'ticketing' ) );
	}

	/**
	 * Constant names upper-case the key and turn hyphens into underscores.
	 *
	 * @return void
	 */
	public function test_constant_name_normalizes_the_key() {
		$this->assertSame(
			'FAIR_TEST_FEATURE_BUNDLED_TRANSLATIONS',
			$this->flags()->constant_name( 'bundled-translations' )
		);
	}

	/**
	 * Sanitizing a non-array submission returns an empty array.
	 *
	 * @return void
	 */
	public function test_sanitize_non_array_returns_empty_array() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = array( 'ticketing' => true );

		$this->assertSame( array(), $this->flags()->sanitize_option( 'on' ) );
		$this->assertSame( array(), $this->flags()->sanitize_option( null ) );
	}

	/**
	 * Unknown and always-on keys are dropped, submitted values are cast, and
	 * defaults are not written.
	 *
	 * @return void
	 */
	public function test_sanitize_drops_unknown_and_always_on_keys() {
		$out = $this->flags()->sanitize_option(
			array(
				'core'                 => false,
				'nope'                 => true,
				'bundled-translations' => '1',
			)
		);

		$this->assertSame( array( 'bundled-translations' => true ), $out );
	}

	/**
	 * Known keys omitted from a submission keep their existing value.
	 *
	 * @return void
	 */
	public function test_sanitize_preserves_omitted_existing_values() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = array( 'ticketing' => 0 );

		$out = $this->flags()->sanitize_option( array( 'bundled-translations' => 0 ) );

		$this->assertSame(
			array(
				'bundled-translations' => false,
				'ticketing'            => false,
			),
			$out
		);
	}

	/**
	 * Malformed existing settings are treated as empty.
	 *
	 * @return void
	 */
	public function test_sanitize_treats_malformed_existing_as_empty() {
		$GLOBALS['_fair_test_options'][ self::OPTION ] = 'garbage';

		$out = $this->flags()->sanitize_option( array( 'ticketing' => true ) );

		$this->assertSame( array( 'ticketing' => true ), $out );
	}

	/**
	 * A per-feature constant wins over stored values and the filter, and
	 * marks only its own key as forced.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_per_feature_constant_wins_and_bypasses_filter() {
		define( 'FAIR_TEST_FEATURE_BUNDLED_TRANSLATIONS', 0 );
		$GLOBALS['_fair_test_options'][ self::OPTION ] = array( 'bundled-translations' => true );
		$GLOBALS['_fair_test_filters'][ self::FILTER ] = static function () {
			return true;
		};
		$flags = $this->flags();

		$this->assertFalse( $flags->is_enabled( 'bundled-translations' ) );
		$this->assertTrue( $flags->is_forced( 'bundled-translations' ) );
		$this->assertFalse( $flags->is_forced( 'ticketing' ) );
	}

	/**
	 * A master switch strictly equal to true enables and forces every
	 * feature, but the filter can still override the resolved value.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_master_switch_enables_and_forces_but_filter_overrides() {
		define( 'FAIR_TEST_INTERNAL', true );
		$GLOBALS['_fair_test_options'][ self::OPTION ] = array( 'ticketing' => false );
		$flags = $this->flags();

		$this->assertTrue( $flags->is_enabled( 'bundled-translations' ) );
		$this->assertTrue( $flags->is_enabled( 'ticketing' ) );
		$this->assertTrue( $flags->is_forced( 'ticketing' ) );

		$GLOBALS['_fair_test_filters'][ self::FILTER ] = static function ( $enabled, $key ) {
			return 'ticketing' === $key ? false : $enabled;
		};

		$this->assertFalse( $flags->is_enabled( 'ticketing' ) );
		$this->assertTrue( $flags->is_forced( 'ticketing' ) );
		$this->assertTrue( $flags->is_enabled( 'bundled-translations' ) );
	}

	/**
	 * A truthy but non-true master switch is ignored.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_master_switch_must_be_strictly_true() {
		define( 'FAIR_TEST_INTERNAL', 1 );
		$flags = $this->flags();

		$this->assertFalse( $flags->is_enabled( 'bundled-translations' ) );
		$this->assertFalse( $flags->is_forced( 'bundled-translations' ) );
	}

	/**
	 * Forced keys keep their existing stored value; a submitted replacement
	 * is ignored, and nothing is written when no value was stored.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_sanitize_keeps_forced_values() {
		define( 'FAIR_TEST_FEATURE_TICKETING', true );
		$GLOBALS['_fair_test_options'][ self::OPTION ] = array( 'ticketing' => 0 );
		$flags = $this->flags();

		$out = $flags->sanitize_option( array( 'ticketing' => true ) );
		$this->assertSame( array( 'ticketing' => false ), $out );

		$GLOBALS['_fair_test_options'][ self::OPTION ] = array();
		$this->assertSame( array(), $flags->sanitize_option( array( 'ticketing' => true ) ) );
	}

	/**
	 * Differently configured resolvers do not see each other's constants,
	 * options, or filters.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_configurations_are_isolated() {
		define( 'FAIR_TEST_INTERNAL', true );
		define( 'FAIR_OTHER_FEATURE_TICKETING', false );
		$GLOBALS['_fair_test_options']['fair_other_flags']        = array( 'bundled-translations' => true );
		$GLOBALS['_fair_test_filters']['fair_other_flag_enabled'] = static function () {
			return false;
		};

		$mine  = $this->flags();
		$other = $this->flags( 'FAIR_OTHER_FEATURE_', 'FAIR_OTHER_INTERNAL', 'fair_other_flags', 'fair_other_flag_enabled' );

		$this->assertTrue( $mine->is_enabled( 'ticketing' ) );
		$this->assertTrue( $mine->is_forced( 'bundled-translations' ) );

		$this->assertFalse( $other->is_enabled( 'ticketing' ) );
		$this->assertTrue( $other->is_forced( 'ticketing' ) );
		$this->assertFalse( $other->is_forced( 'bundled-translations' ) );
		// Stored true, then the other plugin's filter returns false.
		$this->assertFalse( $other->is_enabled( 'bundled-translations' ) );
		unset( $GLOBALS['_fair_test_filters']['fair_other_flag_enabled'] );
		$this->assertTrue( $other->is_enabled( 'bundled-translations' ) );
	}
}
