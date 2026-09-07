<?php
/**
 * Signup confirmation reconciliation tests.
 *
 * @package FairAudience
 */

namespace FairAudience\Tests\Hooks;

use FairAudience\Hooks\SignupHookBridge;
use PHPUnit\Framework\TestCase;
use ReflectionMethod;

/**
 * Covers UTC reservation classification at the reconciliation boundary.
 */
class SignupHookBridgeConfirmationTest extends TestCase {

	/**
	 * Invoke the private classification helper.
	 *
	 * @param object|null $relationship Relationship fixture.
	 * @return bool
	 */
	private function is_active_reservation( $relationship ) {
		$method = new ReflectionMethod( SignupHookBridge::class, 'is_active_reservation' );

		return $method->invoke( null, $relationship );
	}

	/**
	 * An unexpired UTC hold is already capacity-authorized.
	 *
	 * @return void
	 */
	public function test_unexpired_pending_payment_is_active() {
		$this->assertTrue(
			$this->is_active_reservation(
				(object) array(
					'label'              => 'pending_payment',
					'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() + 60 ),
				)
			)
		);
	}

	/**
	 * Missing, elapsed, and non-pending relationships need reconciliation.
	 *
	 * @return void
	 */
	public function test_missing_or_expired_reservation_is_not_active() {
		$this->assertFalse( $this->is_active_reservation( null ) );
		$this->assertFalse(
			$this->is_active_reservation(
				(object) array(
					'label'              => 'pending_payment',
					'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() - 1 ),
				)
			)
		);
		$this->assertFalse(
			$this->is_active_reservation(
				(object) array(
					'label'              => 'pending_payment',
					'payment_expires_at' => null,
				)
			)
		);
		$this->assertFalse(
			$this->is_active_reservation(
				(object) array(
					'label'              => 'signed_up',
					'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() + 60 ),
				)
			)
		);
	}
}
