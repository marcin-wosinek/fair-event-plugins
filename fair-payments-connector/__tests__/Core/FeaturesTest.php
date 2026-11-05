<?php
/**
 * Tests for the Fair Payments Connector feature-flag adapter.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Core;

use FairPaymentsConnector\Core\Features;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;
use PHPUnit\Framework\TestCase;

/**
 * Checks that Features delegates to the shared resolver with this plugin's
 * own option, constants, and filter, and keeps its local presentation.
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
	 * Configuration identifiers are unchanged.
	 *
	 * @return void
	 */
	public function test_identifiers_are_unchanged() {
		$this->assertSame( 'fair_payment_features', Features::OPTION );
		$this->assertSame( 'FAIR_PAYMENTS_CONNECTOR_INTERNAL', Features::MASTER_CONSTANT );
	}

	/**
	 * Resolution reads this plugin's option and filter, and sanitization
	 * keeps omitted values and drops unknown keys.
	 *
	 * @return void
	 */
	public function test_resolves_from_own_option_and_filter() {
		$this->assertFalse( Features::is_enabled( 'bundled-translations' ) );
		$this->assertFalse( Features::is_enabled( 'unknown' ) );

		$GLOBALS['_fair_test_options']['fair_payment_features'] = array( 'bundled-translations' => 1 );
		$this->assertTrue( Features::is_enabled( 'bundled-translations' ) );
		$this->assertFalse( Features::is_forced( 'bundled-translations' ) );

		$GLOBALS['_fair_test_filters']['fair_payment_feature_enabled'] = static function () {
			return false;
		};
		$this->assertFalse( Features::is_enabled( 'bundled-translations' ) );

		$this->assertSame( array(), Features::sanitize_option( 'x' ) );
		$this->assertSame(
			array( 'bundled-translations' => true ),
			Features::sanitize_option( array( 'unknown' => true ) )
		);
	}

	/**
	 * The Settings UI snapshot keeps its metadata.
	 *
	 * @return void
	 */
	public function test_snapshot_metadata_is_unchanged() {
		$all = Features::all();

		$this->assertSame( array( 'core', 'bundled-translations' ), array_keys( $all ) );
		$this->assertSame(
			array(
				'label'       => 'Core',
				'description' => 'Transactions, settings, payment blocks. Always on.',
				'default'     => true,
				'always_on'   => true,
				'enabled'     => true,
				'forced'      => true,
			),
			$all['core']
		);
		$this->assertFalse( $all['bundled-translations']['enabled'] );
		$this->assertFalse( $all['bundled-translations']['forced'] );
	}

	/**
	 * The per-feature constant uses this plugin's prefix; the translations
	 * path follows the flag.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_per_feature_constant_and_translations_path() {
		define( 'FAIR_PAYMENTS_CONNECTOR_PLUGIN_DIR', '/plugin/' );
		$this->assertNull( Features::script_translations_path() );

		define( 'FAIR_PAYMENTS_CONNECTOR_FEATURE_BUNDLED_TRANSLATIONS', true );
		$this->assertTrue( Features::is_enabled( 'bundled-translations' ) );
		$this->assertTrue( Features::is_forced( 'bundled-translations' ) );
		$this->assertSame( '/plugin/build/languages', Features::script_translations_path() );
	}

	/**
	 * The master switch forces every feature on.
	 *
	 * @return void
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_master_switch_forces_features() {
		define( 'FAIR_PAYMENTS_CONNECTOR_INTERNAL', true );
		$GLOBALS['_fair_test_options']['fair_payment_features'] = array( 'bundled-translations' => false );

		$this->assertTrue( Features::is_enabled( 'bundled-translations' ) );
		$this->assertTrue( Features::is_forced( 'bundled-translations' ) );
		$this->assertSame(
			array( 'bundled-translations' => false ),
			Features::sanitize_option( array( 'bundled-translations' => true ) )
		);
	}
}
