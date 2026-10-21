<?php
/**
 * Meta integration boundary with Fair Payments Connector.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Meta;

use FairEventsExperimental\Meta\Conversions;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;

/**
 * Only checkout and purchase measurement depends on payments; delivery and
 * cleanup run without them.
 */
class ConversionsPaymentsBoundaryTest extends TestCase {
	/** Reset recorded hooks and HTTP requests before each test. */
	protected function setUp(): void {
		parent::setUp();
		$GLOBALS['_fair_test_hooks']                = array();
		$GLOBALS['_fair_test_remote_post_requests'] = array();
	}

	/** Without the payment connector only delivery and cleanup are wired. */
	public function test_init_without_payments_registers_only_delivery_and_cleanup() {
		$this->assertFalse( Conversions::payments_available() );

		( new Conversions() )->init();

		$this->assertSame(
			array( Conversions::DELIVERY_HOOK, Conversions::CLEANUP_HOOK ),
			array_keys( $GLOBALS['_fair_test_hooks'] )
		);
	}

	/** Payment hooks that fire anyway return without touching Transaction. */
	public function test_payment_callbacks_without_payments_do_nothing() {
		$service = new Conversions();

		$service->checkout_initiated( 42 );
		$service->payment_paid( (object) array(), (object) array( 'id' => 42 ) );

		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
	}

	/** With the payment connector, checkout and purchase hooks are wired too. */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_init_with_payments_registers_checkout_and_purchase_hooks() {
		// phpcs:ignore Squiz.PHP.Eval.Discouraged -- defines a stand-in class in an isolated process.
		eval( 'namespace FairPaymentsConnector\Models; class Transaction {}' );
		$GLOBALS['_fair_test_hooks'] = array();

		$this->assertTrue( Conversions::payments_available() );
		( new Conversions() )->init();

		foreach ( array( Conversions::DELIVERY_HOOK, Conversions::CLEANUP_HOOK, 'fair_payment_payment_initiated', 'fair_payment_paid', 'fair_payment_before_initiate_payment' ) as $hook ) {
			$this->assertArrayHasKey( $hook, $GLOBALS['_fair_test_hooks'] );
		}
	}
}
