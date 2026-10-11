<?php
/**
 * Ownership tests
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Notifications;

use FairEvents\Notifications\Ownership;
use PHPUnit\Framework\TestCase;

/**
 * Who runs each notification channel, for every legacy-plugin state.
 */
class OwnershipTest extends TestCase {

	/**
	 * Start without a marker.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/** A channel can be taken over while its former owner is inactive. */
	public function test_takes_over_while_the_former_owner_is_inactive() {
		$this->assertTrue( Ownership::resolve( false, false ) );
	}

	/** A channel can be taken over from a former owner that hands it over. */
	public function test_takes_over_from_a_former_owner_that_hands_over() {
		$this->assertTrue( Ownership::resolve( true, true ) );
	}

	/** A release older than the handoff keeps its channel. */
	public function test_leaves_the_channel_to_a_release_without_the_handoff() {
		$this->assertFalse( Ownership::resolve( true, false ) );
	}

	/** Nothing is owned before its settings and history were taken over. */
	public function test_owns_nothing_before_the_takeover() {
		$this->assertFalse( Ownership::owns( Ownership::TELEGRAM ) );
		$this->assertFalse( Ownership::owns( Ownership::BULK_EMAIL ) );
	}

	/** Channels are taken over independently. */
	public function test_channels_are_marked_independently() {
		Ownership::mark_migrated( Ownership::TELEGRAM, array( 'kept_enabled' => true ) );

		$this->assertTrue( Ownership::owns( Ownership::TELEGRAM ) );
		$this->assertFalse( Ownership::owns( Ownership::BULK_EMAIL ) );

		Ownership::mark_migrated( Ownership::BULK_EMAIL );

		$this->assertTrue( Ownership::owns( Ownership::TELEGRAM ) );
		$this->assertTrue( Ownership::owns( Ownership::BULK_EMAIL ) );
		$this->assertTrue( $GLOBALS['_fair_test_options'][ Ownership::OPTION ]['telegram']['kept_enabled'] );
	}

	/**
	 * An active release without the handoff suspends an owned channel.
	 *
	 * @runInSeparateProcess
	 * @preserveGlobalState disabled
	 */
	public function test_an_older_legacy_release_suspends_its_channel_only() {
		Ownership::mark_migrated( Ownership::TELEGRAM );
		Ownership::mark_migrated( Ownership::BULK_EMAIL );
		define( 'FAIR_EVENTS_EXPERIMENTAL_VERSION', '1.11.0' );

		$this->assertFalse( Ownership::owns( Ownership::TELEGRAM ) );
		$this->assertTrue( Ownership::owns( Ownership::BULK_EMAIL ) );
	}

	/**
	 * The constants are a contract with the plugins that define them.
	 */
	public function test_constants_match_the_plugins_that_define_them() {
		$root = dirname( __DIR__, 3 );

		$this->assertStringContainsString(
			"define( '" . Ownership::OWNS_CONSTANT . "', true );",
			file_get_contents( $root . '/fair-events/fair-events.php' ) // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
		);
		$this->assertStringContainsString(
			"define( '" . Ownership::LEGACY[ Ownership::TELEGRAM ]['handoff'] . "', true );",
			file_get_contents( $root . '/fair-events-experimental/fair-events-experimental.php' ) // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
		);
		$this->assertStringContainsString(
			"define( '" . Ownership::LEGACY[ Ownership::TELEGRAM ]['active'] . "',",
			file_get_contents( $root . '/fair-events-experimental/fair-events-experimental.php' ) // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
		);
		$audience = file_get_contents( $root . '/fair-audience/fair-audience.php' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- local file.
		$this->assertStringContainsString( "define( '" . Ownership::LEGACY[ Ownership::BULK_EMAIL ]['handoff'] . "', true );", $audience );
		$this->assertStringContainsString( "define( '" . Ownership::LEGACY[ Ownership::BULK_EMAIL ]['active'] . "',", $audience );
	}
}
