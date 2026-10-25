<?php
/**
 * Retired feature choice tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Database;

// The removal swaps the WordPress hook global for the duration of each test.
// phpcs:disable WordPress.WP.GlobalVariablesOverride.Prohibited

use FairAudience\Database\RetiredFeatureChoice;
use PHPUnit\Framework\TestCase;

/**
 * Covers the 1.47.0 removal of the stored `collaborators` choice.
 */
class RetiredFeatureChoiceTest extends TestCase {

	/**
	 * Seed a site that still stores the retired choice.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['wp_filter']          = array();
		$GLOBALS['_fair_test_options'] = array(
			'fair_audience_experimental_features' => array(
				'collaborators' => false,
				'polls'         => true,
				'groups'        => false,
			),
		);
	}

	/**
	 * Remove the doubles after each test.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		unset( $GLOBALS['wp_filter'] );
		$GLOBALS['_fair_test_options'] = array();
		parent::tearDown();
	}

	/**
	 * Only the retired choice is removed; other choices keep their values.
	 *
	 * @return void
	 */
	public function test_removes_only_the_retired_choice() {
		$this->assertTrue( RetiredFeatureChoice::remove( 'collaborators' ) );
		$this->assertSame(
			array(
				'polls'  => true,
				'groups' => false,
			),
			$GLOBALS['_fair_test_options']['fair_audience_experimental_features']
		);
	}

	/**
	 * A second run succeeds without changes.
	 *
	 * @return void
	 */
	public function test_repeated_run_is_a_no_op() {
		RetiredFeatureChoice::remove( 'collaborators' );
		$options_after_first = $GLOBALS['_fair_test_options'];

		$this->assertTrue( RetiredFeatureChoice::remove( 'collaborators' ) );
		$this->assertSame( $options_after_first, $GLOBALS['_fair_test_options'] );
	}

	/**
	 * Without a stored option nothing is written and the run succeeds.
	 *
	 * @return void
	 */
	public function test_missing_option_is_left_alone() {
		$GLOBALS['_fair_test_options'] = array();

		$this->assertTrue( RetiredFeatureChoice::remove( 'collaborators' ) );
		$this->assertSame( array(), $GLOBALS['_fair_test_options'] );
	}

	/**
	 * An older companion's sanitizer, which would restore the stored choice,
	 * is detached for the write and restored afterwards.
	 *
	 * @return void
	 */
	public function test_old_companion_sanitizer_does_not_restore_the_choice() {
		$sanitizer = array(
			'callback' => function ( $value ) {
				$stored = get_option( 'fair_audience_experimental_features', array() );
				return $value + array_intersect_key( $stored, array( 'collaborators' => true ) );
			},
		);

		$GLOBALS['wp_filter']['sanitize_option_fair_audience_experimental_features'] = $sanitizer;

		$this->assertTrue( RetiredFeatureChoice::remove( 'collaborators' ) );
		$this->assertArrayNotHasKey(
			'collaborators',
			$GLOBALS['_fair_test_options']['fair_audience_experimental_features']
		);
		$this->assertSame(
			$sanitizer,
			$GLOBALS['wp_filter']['sanitize_option_fair_audience_experimental_features']
		);
	}
}
