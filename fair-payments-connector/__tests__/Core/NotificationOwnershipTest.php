<?php
/**
 * NotificationOwnership tests
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Core;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Core\NotificationOwnership;

/**
 * Exactly one plugin runs notifications for every combination of installed
 * releases, in either update order.
 */
class NotificationOwnershipTest extends TestCase {

	/**
	 * Without the experimental plugin, this plugin owns notifications.
	 */
	public function test_owns_notifications_when_the_experimental_plugin_is_inactive() {
		$this->assertTrue( NotificationOwnership::resolve( false, false ) );
	}

	/**
	 * Updated experimental plugin hands notifications over.
	 */
	public function test_owns_notifications_when_the_experimental_plugin_hands_off() {
		$this->assertTrue( NotificationOwnership::resolve( true, true ) );
	}

	/**
	 * Main plugin updated first: the older experimental release keeps running
	 * notifications, so this plugin stays out of the way.
	 */
	public function test_leaves_notifications_to_an_experimental_release_without_the_handoff() {
		$this->assertFalse( NotificationOwnership::resolve( true, false ) );
	}

	/**
	 * The live check reads the constants the plugins define; with none of the
	 * experimental ones defined this plugin is the owner.
	 */
	public function test_is_owner_reads_the_experimental_constants() {
		$this->assertFalse( defined( NotificationOwnership::EXPERIMENTAL_VERSION_CONSTANT ) );
		$this->assertTrue( NotificationOwnership::is_owner() );
	}

	/**
	 * The signal names match the ones the experimental plugin reads and defines.
	 */
	public function test_signal_names_match_the_experimental_plugin() {
		$this->assertSame( 'FAIR_PAYMENTS_CONNECTOR_OWNS_NOTIFICATIONS', NotificationOwnership::OWNS_CONSTANT );
		$this->assertSame( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_NOTIFICATIONS_HANDOFF', NotificationOwnership::HANDOFF_CONSTANT );
		$this->assertSame( 'FAIR_PAYMENTS_CONNECTOR_EXPERIMENTAL_VERSION', NotificationOwnership::EXPERIMENTAL_VERSION_CONSTANT );
	}
}
