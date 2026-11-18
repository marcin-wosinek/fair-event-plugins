<?php
/**
 * Tests for the Instagram connection ownership handshake.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Instagram;

use FairEventsExperimental\Core\Features;
use FairEventsExperimental\Instagram\Connection;
use FairEventsExperimental\Instagram\Ownership;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Exactly one plugin protects and refreshes the token, including while the
 * plugins are updated one at a time.
 */
class OwnershipTest extends TestCase {

	/**
	 * Reset the option store and filters.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
		$GLOBALS['_fair_test_filters'] = array();
	}

	/**
	 * Clear fixtures.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['_fair_test_options'] = array();
		$GLOBALS['_fair_test_filters'] = array();
	}

	/**
	 * Former-owner states: active?, hands off?, can this plugin take over?
	 *
	 * @return array<string,array{bool,bool,bool}>
	 */
	public static function legacy_states() {
		return array(
			'former owner inactive'           => array( false, false, true ),
			'former owner updated'            => array( true, true, true ),
			'former owner older than handoff' => array( true, false, false ),
		);
	}

	/**
	 * The connection is taken over only from an absent or updated owner.
	 *
	 * @param bool $active   Former owner active.
	 * @param bool $handoff  Former owner hands over.
	 * @param bool $expected Whether this plugin may take over.
	 * @return void
	 */
	#[DataProvider( 'legacy_states' )]
	public function test_resolve( $active, $handoff, $expected ) {
		$this->assertSame( $expected, Ownership::resolve( $active, $handoff ) );
	}

	/**
	 * Only an older Fair Audience Experimental with its own Instagram bundle
	 * on still refreshes the token; then this plugin does not.
	 *
	 * @return void
	 */
	public function test_legacy_refresh_runs_only_for_an_older_enabled_release() {
		$this->assertTrue( Ownership::legacy_refresh_runs( true, false, true ) );
		$this->assertFalse( Ownership::legacy_refresh_runs( true, false, false ) );
		$this->assertFalse( Ownership::legacy_refresh_runs( true, true, true ) );
		$this->assertFalse( Ownership::legacy_refresh_runs( false, false, true ) );
	}

	/**
	 * Off by default on a site without a connection.
	 *
	 * @return void
	 */
	public function test_feature_stays_off_without_a_connection() {
		Ownership::maybe_enable_for_existing_connection();

		$this->assertFalse( Features::is_enabled( 'instagram' ) );
		$this->assertSame( 1, get_option( Ownership::FEATURE_MIGRATION_OPTION ) );
	}

	/**
	 * An existing connection keeps working: the feature is turned on once.
	 *
	 * @return void
	 */
	public function test_existing_connection_turns_the_feature_on() {
		$GLOBALS['_fair_test_options'][ Connection::CONNECTED_OPTION ] = true;
		$GLOBALS['_fair_test_options'][ Features::OPTION ]             = array( 'sources' => false );

		Ownership::maybe_enable_for_existing_connection();

		$this->assertTrue( Features::is_enabled( 'instagram' ) );
		$this->assertSame(
			array(
				'sources'   => false,
				'instagram' => true,
			),
			get_option( Features::OPTION )
		);
	}

	/**
	 * An administrator's explicit choice is kept, and the decision is made
	 * only once.
	 *
	 * @return void
	 */
	public function test_explicit_setting_and_later_runs_are_left_alone() {
		$GLOBALS['_fair_test_options'][ Connection::CONNECTED_OPTION ] = true;
		$GLOBALS['_fair_test_options'][ Features::OPTION ]             = array( 'instagram' => false );

		Ownership::maybe_enable_for_existing_connection();
		$this->assertFalse( Features::is_enabled( 'instagram' ) );

		$GLOBALS['_fair_test_options'][ Features::OPTION ] = array();
		Ownership::maybe_enable_for_existing_connection();
		$this->assertFalse( Features::is_enabled( 'instagram' ) );
	}

	/**
	 * Nothing is claimed while the feature is off.
	 *
	 * @return void
	 */
	public function test_feature_off_does_not_claim() {
		$this->assertFalse( Ownership::claims() );
		$this->assertFalse( Ownership::blocked_by_legacy() );
	}
}
