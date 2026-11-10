<?php
/**
 * Purchase lifecycle rule tests for Fair Audience's routes.
 *
 * @package FairEvents
 */

namespace FairEvents\Tests\Services;

use FairEvents\Services\PurchaseLifecycle;
use FairEvents\Services\ShadowPurchases;
use PHPUnit\Framework\TestCase;

/**
 * Covers PAYMENT_HISTORY_MIGRATION.md §8.12: a series upgrade is priced
 * from the purchase's own paid allocations (§5.6, gap G4), and a shadow
 * purchase sync never reverses a confirmation the lifecycle made (#2251).
 */
class PurchaseLifecycleRulesTest extends TestCase {

	/**
	 * A link as PaymentLinks::get_for_signup() returns it.
	 *
	 * @param string      $role     Role.
	 * @param string      $amount   Allocated amount.
	 * @param string|null $status   Transaction status; null for a deleted transaction.
	 * @param string      $currency Currency.
	 * @return array
	 */
	private static function link( $role, $amount, $status, $currency = 'EUR' ) {
		return array(
			'role'             => $role,
			'allocated_amount' => $amount,
			'currency'         => $currency,
			'transaction'      => null === $status ? null : array( 'status' => $status ),
		);
	}

	/**
	 * Only paid allocations in the requested currency count; refund records and deleted transactions never do.
	 *
	 * @return void
	 */
	public function test_upgrade_credit_sums_only_paid_allocations_of_the_purchase(): void {
		$links = array(
			self::link( 'charge', '10.10', 'failed' ),
			self::link( 'charge', '10.10', 'paid' ),
			self::link( 'additional_charge', '5.20', 'paid' ),
			self::link( 'upgrade', '4.70', 'paid' ),
			self::link( 'legacy_refund_record', '0.00', 'paid' ),
			self::link( 'charge', '99.00', null ),
			self::link( 'charge', '7.00', 'paid', 'PLN' ),
		);

		$this->assertSame( 20.0, PurchaseLifecycle::paid_allocation_total( $links, 'EUR' ) );
		$this->assertSame( 7.0, PurchaseLifecycle::paid_allocation_total( $links, 'pln' ) );
		$this->assertSame( 0.0, PurchaseLifecycle::paid_allocation_total( array(), 'EUR' ) );
	}

	/**
	 * Allocations are added in whole cents.
	 *
	 * @return void
	 */
	public function test_upgrade_credit_adds_in_cents(): void {
		$links = array(
			self::link( 'charge', '0.10', 'paid' ),
			self::link( 'charge', '0.20', 'paid' ),
		);

		$this->assertSame( 0.3, PurchaseLifecycle::paid_allocation_total( $links, 'EUR' ) );
	}

	/**
	 * A relationship still awaiting payment, or gone, leaves a confirmed purchase confirmed.
	 *
	 * @return void
	 */
	public function test_lagging_relationship_never_undoes_a_lifecycle_confirmation(): void {
		$pending = (object) array(
			'label'              => 'pending_payment',
			'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() + 600 ),
		);
		$expired = (object) array(
			'label'              => 'pending_payment',
			'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() - 600 ),
		);

		$this->assertSame( 'confirmed', ShadowPurchases::target_state( $pending, 'confirmed' )['status'] );
		$this->assertSame( 'confirmed', ShadowPurchases::target_state( $expired, 'confirmed' )['status'] );
		$this->assertSame( 'confirmed', ShadowPurchases::target_state( null, 'confirmed' )['status'] );
		$this->assertNull( ShadowPurchases::target_state( $pending, 'confirmed' )['payment_expires_at'] );
	}

	/**
	 * Relabelling, re-holding and an expired hold are still followed.
	 *
	 * @return void
	 */
	public function test_organizer_changes_are_still_followed(): void {
		$interested = (object) array(
			'label'              => 'interested',
			'payment_expires_at' => null,
		);
		$pending    = (object) array(
			'label'              => 'pending_payment',
			'payment_expires_at' => gmdate( 'Y-m-d H:i:s', time() + 600 ),
		);

		$this->assertSame( 'cancelled', ShadowPurchases::target_state( $interested, 'confirmed' )['status'] );
		$this->assertSame( 'pending_payment', ShadowPurchases::target_state( $pending, 'expired' )['status'] );
		$this->assertSame( 'expired', ShadowPurchases::target_state( null, 'pending_payment' )['status'] );
	}
}
