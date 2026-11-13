<?php
/**
 * Tests for the Fair Events Experimental feature-flag adapter.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Core;

use FairEventsExperimental\Core\Features;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Checks that Features delegates to the shared resolver with this plugin's
 * own option, constants, and filter, and keeps its stored-setting meaning.
 */
class FeaturesTest extends TestCase {

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
	 * Resolved state of every registry key.
	 *
	 * @return array<string,bool>
	 */
	private function resolved() {
		$out = array();
		foreach ( array_keys( Features::registry() ) as $key ) {
			$out[ $key ] = Features::is_enabled( $key );
		}
		return $out;
	}

	/**
	 * Configuration identifiers are unchanged.
	 *
	 * @return void
	 */
	public function test_identifiers_are_unchanged() {
		$this->assertSame( 'fair_events_experimental_features', Features::OPTION );
		$this->assertSame( 'FAIR_EVENTS_EXPERIMENTAL_INTERNAL', Features::MASTER_CONSTANT );
	}

	/**
	 * With nothing stored, every key resolves to its registry default and
	 * unknown keys stay disabled.
	 *
	 * @return void
	 */
	public function test_defaults_and_unknown_keys() {
		$this->assertSame(
			array(
				'sources'          => true,
				'ticketing'        => true,
				'mailings'         => true,
				'meta-conversions' => false,
			),
			$this->resolved()
		);
		$this->assertFalse( Features::is_enabled( 'unknown' ) );
		$this->assertFalse( Features::is_forced( 'unknown' ) );
	}

	/**
	 * Stored values override the default in both directions, including
	 * explicit false and null; a malformed option falls back to defaults.
	 *
	 * @return void
	 */
	public function test_stored_values_override_defaults() {
		$GLOBALS['_fair_test_options']['fair_events_experimental_features'] = array( 'meta-conversions' => true );
		$this->assertSame( true, Features::is_enabled( 'meta-conversions' ) );
		$this->assertFalse( Features::is_forced( 'meta-conversions' ) );

		$GLOBALS['_fair_test_options']['fair_events_experimental_features'] = array( 'meta-conversions' => false );
		$this->assertSame( false, Features::is_enabled( 'meta-conversions' ) );

		$GLOBALS['_fair_test_options']['fair_events_experimental_features'] = array( 'meta-conversions' => null );
		$this->assertFalse( Features::is_enabled( 'meta-conversions' ) );

		$GLOBALS['_fair_test_options']['fair_events_experimental_features'] = 'malformed';
		$this->assertSame( false, Features::is_enabled( 'meta-conversions' ) );
	}

	/**
	 * Only this plugin's filter applies, and it receives the resolved value.
	 *
	 * @return void
	 */
	public function test_filter_is_isolated_to_this_plugin() {
		$GLOBALS['_fair_test_filters']['fair_audience_experimental_feature_enabled'] = static function () {
			return true;
		};
		$this->assertSame( false, Features::is_enabled( 'meta-conversions' ) );

		$seen = array();
		$GLOBALS['_fair_test_filters']['fair_events_experimental_feature_enabled'] = static function ( $enabled, $key = null ) use ( &$seen ) {
			$seen[] = array( $enabled, $key );
			return ! $enabled;
		};
		$this->assertSame( true, Features::is_enabled( 'meta-conversions' ) );
		$this->assertSame( array( array( false, 'meta-conversions' ) ), $seen );
	}

	/**
	 * Sanitization keeps known submitted and omitted values, drops unknown
	 * and always-on keys, and never writes defaults.
	 *
	 * @return void
	 */
	public function test_sanitize_option() {
		$this->assertSame( array(), Features::sanitize_option( 'x' ) );
		$this->assertSame( array(), Features::sanitize_option( null ) );
		$this->assertSame( array(), Features::sanitize_option( array( 'unknown' => true ) ) );
		$this->assertSame(
			array( 'meta-conversions' => true ),
			Features::sanitize_option( array( 'meta-conversions' => 1 ) )
		);

		$GLOBALS['_fair_test_options']['fair_events_experimental_features'] = array( 'ticketing' => false );
		$this->assertSame(
			array( 'ticketing' => false ),
			Features::sanitize_option( array() )
		);
	}

	/**
	 * The Settings UI snapshot keeps its keys and resolved state.
	 *
	 * @return void
	 */
	public function test_snapshot_keeps_keys_and_state() {
		$all = Features::all();

		$this->assertSame( array( 'sources', 'ticketing', 'mailings', 'meta-conversions' ), array_keys( $all ) );
		$entry = $all['meta-conversions'];
		$this->assertSame( Features::registry()['meta-conversions']['label'], $entry['label'] );
		$this->assertSame( false, $entry['default'] );
		$this->assertFalse( $entry['always_on'] );
		$this->assertSame( false, $entry['enabled'] );
		$this->assertFalse( $entry['forced'] );
	}

	/**
	 * A per-feature constant wins over the stored value and bypasses the
	 * filter; the sanitizer keeps the stored value of a forced key.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_per_feature_constant_wins() {
		$GLOBALS['_fair_test_options']['fair_events_experimental_features']        = array( 'meta-conversions' => false );
		$GLOBALS['_fair_test_filters']['fair_events_experimental_feature_enabled'] = static function () {
			return false;
		};
		define( 'FAIR_EVENTS_EXPERIMENTAL_FEATURE_META_CONVERSIONS', true );

		$this->assertSame( true, Features::is_enabled( 'meta-conversions' ) );
		$this->assertTrue( Features::is_forced( 'meta-conversions' ) );
		$this->assertSame(
			array( 'meta-conversions' => false ),
			Features::sanitize_option( array( 'meta-conversions' => true ) )
		);
	}

	/**
	 * The master switch enables and forces flags; the filter can still
	 * override its enabled result.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_master_switch_forces_features() {
		define( 'FAIR_EVENTS_EXPERIMENTAL_INTERNAL', true );
		$GLOBALS['_fair_test_options']['fair_events_experimental_features'] = array( 'meta-conversions' => false );

		$this->assertTrue( Features::is_enabled( 'meta-conversions' ) );
		$this->assertTrue( Features::is_forced( 'meta-conversions' ) );
		$this->assertSame(
			array( 'meta-conversions' => false ),
			Features::sanitize_option( array( 'meta-conversions' => true ) )
		);

		$GLOBALS['_fair_test_filters']['fair_events_experimental_feature_enabled'] = static function () {
			return false;
		};
		$this->assertFalse( Features::is_enabled( 'meta-conversions' ) );
		$this->assertTrue( Features::is_forced( 'meta-conversions' ) );
	}

	/**
	 * A master constant that is truthy but not strictly true is ignored.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_non_true_master_switch_is_ignored() {
		define( 'FAIR_EVENTS_EXPERIMENTAL_INTERNAL', 1 );

		$this->assertSame( false, Features::is_enabled( 'meta-conversions' ) );
		$this->assertFalse( Features::is_forced( 'meta-conversions' ) );
	}

	/**
	 * The translations path follows the bundled-translations flag.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_translations_path_follows_flag() {
		define( 'FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR', '/plugin/' );
		$this->assertSame( '/plugin/build/languages', Features::script_translations_path() );
	}
}
