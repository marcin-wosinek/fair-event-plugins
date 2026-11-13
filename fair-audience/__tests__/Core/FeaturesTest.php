<?php
/**
 * Tests for the Fair Audience feature-flag adapter.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Core;

use FairAudience\Core\Features;
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
		$this->assertSame( 'fair_audience_features', Features::OPTION );
		$this->assertSame( 'FAIR_AUDIENCE_INTERNAL', Features::MASTER_CONSTANT );
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
				'core'                 => true,
				'bundled-translations' => false,
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
		$GLOBALS['_fair_test_options']['fair_audience_features'] = array( 'bundled-translations' => true );
		$this->assertSame( true, Features::is_enabled( 'bundled-translations' ) );
		$this->assertFalse( Features::is_forced( 'bundled-translations' ) );

		$GLOBALS['_fair_test_options']['fair_audience_features'] = array( 'bundled-translations' => false );
		$this->assertSame( false, Features::is_enabled( 'bundled-translations' ) );

		$GLOBALS['_fair_test_options']['fair_audience_features'] = array( 'bundled-translations' => null );
		$this->assertFalse( Features::is_enabled( 'bundled-translations' ) );

		$GLOBALS['_fair_test_options']['fair_audience_features'] = 'malformed';
		$this->assertSame( false, Features::is_enabled( 'bundled-translations' ) );
	}

	/**
	 * Only this plugin's filter applies, and it receives the resolved value.
	 *
	 * @return void
	 */
	public function test_filter_is_isolated_to_this_plugin() {
		$GLOBALS['_fair_test_filters']['fair_events_feature_enabled'] = static function () {
			return true;
		};
		$this->assertSame( false, Features::is_enabled( 'bundled-translations' ) );

		$seen = array();
		$GLOBALS['_fair_test_filters']['fair_audience_feature_enabled'] = static function ( $enabled, $key = null ) use ( &$seen ) {
			$seen[] = array( $enabled, $key );
			return ! $enabled;
		};
		$this->assertSame( true, Features::is_enabled( 'bundled-translations' ) );
		$this->assertSame( array( array( false, 'bundled-translations' ) ), $seen );
		$this->assertTrue( Features::is_enabled( 'core' ) );
		$this->assertTrue( Features::is_forced( 'core' ) );
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
		$this->assertSame( array(), Features::sanitize_option( array( 'core' => false ) ) );
		$this->assertSame(
			array( 'bundled-translations' => true ),
			Features::sanitize_option( array( 'bundled-translations' => 1 ) )
		);

		$GLOBALS['_fair_test_options']['fair_audience_features'] = array( 'bundled-translations' => true );
		$this->assertSame(
			array( 'bundled-translations' => true ),
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

		$this->assertSame( array( 'core', 'bundled-translations' ), array_keys( $all ) );
		$entry = $all['bundled-translations'];
		$this->assertSame( Features::registry()['bundled-translations']['label'], $entry['label'] );
		$this->assertSame( false, $entry['default'] );
		$this->assertFalse( $entry['always_on'] );
		$this->assertSame( false, $entry['enabled'] );
		$this->assertFalse( $entry['forced'] );
		$this->assertTrue( $all['core']['always_on'] );
		$this->assertTrue( $all['core']['forced'] );
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
		$GLOBALS['_fair_test_options']['fair_audience_features']        = array( 'bundled-translations' => false );
		$GLOBALS['_fair_test_filters']['fair_audience_feature_enabled'] = static function () {
			return false;
		};
		define( 'FAIR_AUDIENCE_FEATURE_BUNDLED_TRANSLATIONS', true );

		$this->assertSame( true, Features::is_enabled( 'bundled-translations' ) );
		$this->assertTrue( Features::is_forced( 'bundled-translations' ) );
		$this->assertSame(
			array( 'bundled-translations' => false ),
			Features::sanitize_option( array( 'bundled-translations' => true ) )
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
		define( 'FAIR_AUDIENCE_INTERNAL', true );
		$GLOBALS['_fair_test_options']['fair_audience_features'] = array( 'bundled-translations' => false );

		$this->assertTrue( Features::is_enabled( 'bundled-translations' ) );
		$this->assertTrue( Features::is_forced( 'bundled-translations' ) );
		$this->assertSame(
			array( 'bundled-translations' => false ),
			Features::sanitize_option( array( 'bundled-translations' => true ) )
		);

		$GLOBALS['_fair_test_filters']['fair_audience_feature_enabled'] = static function () {
			return false;
		};
		$this->assertFalse( Features::is_enabled( 'bundled-translations' ) );
		$this->assertTrue( Features::is_forced( 'bundled-translations' ) );
	}

	/**
	 * A master constant that is truthy but not strictly true is ignored.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_non_true_master_switch_is_ignored() {
		define( 'FAIR_AUDIENCE_INTERNAL', 1 );

		$this->assertSame( false, Features::is_enabled( 'bundled-translations' ) );
		$this->assertFalse( Features::is_forced( 'bundled-translations' ) );
	}

	/**
	 * The translations path follows the bundled-translations flag.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_translations_path_follows_flag() {
		define( 'FAIR_AUDIENCE_PLUGIN_DIR', '/plugin/' );
		$this->assertNull( Features::script_translations_path() );

		$GLOBALS['_fair_test_options']['fair_audience_features'] = array( 'bundled-translations' => true );
		$this->assertSame( '/plugin/build/languages', Features::script_translations_path() );
	}
}
