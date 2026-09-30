<?php
/**
 * NotificationHandoff tests
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\Core;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnectorExperimental\Core\NotificationHandoff;

/**
 * This plugin runs notifications next to an older Fair Payments Connector and
 * hands them over once that plugin owns them.
 */
class NotificationHandoffTest extends TestCase {

	/**
	 * Constants cannot be undefined, so both states are checked in order.
	 */
	public function test_yields_only_once_fair_payments_connector_owns_notifications() {
		$this->assertFalse( NotificationHandoff::yields() );

		define( NotificationHandoff::MAIN_OWNS_CONSTANT, true );

		$this->assertTrue( NotificationHandoff::yields() );
	}
}
