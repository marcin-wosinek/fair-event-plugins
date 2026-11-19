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
	 * An existing connection does not turn the feature on: only an
	 * administrator does, and nothing is claimed until then.
	 *
	 * @return void
	 */
	public function test_existing_connection_leaves_the_feature_off() {
		$GLOBALS['_fair_test_options'][ Connection::CONNECTED_OPTION ] = true;
		$GLOBALS['_fair_test_options'][ Features::OPTION ]             = array( 'sources' => false );

		$this->assertFalse( method_exists( Ownership::class, 'maybe_enable_for_existing_connection' ) );
		$this->assertFalse( Features::is_enabled( 'instagram' ) );
		$this->assertFalse( Ownership::claims() );
		$this->assertSame( array( 'sources' => false ), get_option( Features::OPTION ) );
	}

	/**
	 * Ownership states and the reason each reports: owns?, feature on?,
	 * Fair Audience active?, it hands off at runtime?, its files hand off?,
	 * expected reason.
	 *
	 * @return array<string,array{bool,bool,bool,bool,bool,string}>
	 */
	public static function reason_states() {
		return array(
			'claimed'                              => array( true, true, true, true, true, Ownership::REASON_MANAGED_HERE ),
			'claimed with Fair Audience inactive'  => array( true, true, false, false, false, Ownership::REASON_MANAGED_HERE ),
			'feature off'                          => array( false, false, true, true, true, Ownership::REASON_FEATURE_OFF ),
			'genuinely older Fair Audience'        => array( false, true, true, false, false, Ownership::REASON_AUDIENCE_HANDOFF_MISSING ),
			'updated Fair Audience not loaded'     => array( false, true, true, false, true, Ownership::REASON_AUDIENCE_UPDATE_NOT_LOADED ),
			'updated Fair Audience, claim missed'  => array( false, true, true, true, true, Ownership::REASON_NOT_CLAIMED ),
			'Fair Audience inactive, claim missed' => array( false, true, false, false, false, Ownership::REASON_NOT_CLAIMED ),
		);
	}

	/**
	 * Updating Fair Audience is recommended only when its handoff is
	 * actually absent, in the code that ran and on disk.
	 *
	 * @param bool   $owns       Claimed.
	 * @param bool   $feature_on Feature on.
	 * @param bool   $active     Fair Audience active.
	 * @param bool   $hands_off  Runtime handoff.
	 * @param bool   $files      Handoff on disk.
	 * @param string $expected   Reason.
	 * @return void
	 */
	#[DataProvider( 'reason_states' )]
	public function test_resolve_reason( $owns, $feature_on, $active, $hands_off, $files, $expected ) {
		$this->assertSame( $expected, Ownership::resolve_reason( $owns, $feature_on, $active, $hands_off, $files ) );
	}

	/**
	 * Without the feature, the request reports it as the reason.
	 *
	 * @return void
	 */
	public function test_reason_reports_the_feature_off() {
		$this->assertSame( Ownership::REASON_FEATURE_OFF, Ownership::reason() );
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
