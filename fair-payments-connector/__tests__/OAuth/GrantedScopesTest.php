<?php
/**
 * GrantedScopes tests — recorded Mollie permissions and the settlement
 * access check (#1693).
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\OAuth;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\OAuth\GrantedScopes;

/**
 * Unit tests for GrantedScopes.
 */
class GrantedScopesTest extends TestCase {

	/**
	 * Reset stored options before each test.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/** Mollie's space-separated string becomes a unique list. */
	public function test_normalize_splits_and_deduplicates() {
		$this->assertSame(
			array( 'payments.read', 'settlements.read' ),
			GrantedScopes::normalize( "  payments.read settlements.read\tpayments.read " )
		);
	}

	/** Anything that is not a well-formed scope is dropped. */
	public function test_normalize_drops_malformed_values() {
		$this->assertSame(
			array( 'payments.read' ),
			GrantedScopes::normalize( 'payments.read <script> settlements SETTLEMENTS.READ settlements.read;' )
		);
		$this->assertSame( array(), GrantedScopes::normalize( '' ) );
		$this->assertSame( array(), GrantedScopes::normalize( null ) );
		$this->assertSame( array(), GrantedScopes::normalize( array( 'settlements.read' ) ) );
	}

	/** A connection with no scope metadata has unknown permissions. */
	public function test_legacy_connection_has_unknown_scopes_and_no_settlement_access() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected'] = true;

		$this->assertNull( GrantedScopes::get() );
		$this->assertFalse( GrantedScopes::has_settlement_access() );
	}

	/** Settlement access needs the exact scope, not a similar one. */
	public function test_settlement_access_requires_exact_scope_match() {
		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected'] = true;

		GrantedScopes::store( 'payments.read settlements.write settlements.readonly' );
		$this->assertFalse( GrantedScopes::has_settlement_access() );

		GrantedScopes::store( 'payments.read settlements.read' );
		$this->assertSame( array( 'payments.read', 'settlements.read' ), GrantedScopes::get() );
		$this->assertTrue( GrantedScopes::has_settlement_access() );
	}

	/** Recorded scopes mean nothing without an active connection. */
	public function test_settlement_access_requires_an_active_connection() {
		GrantedScopes::store( 'settlements.read' );

		$GLOBALS['_fair_test_options']['fair_payment_mollie_connected'] = false;
		$this->assertFalse( GrantedScopes::has_settlement_access() );
	}

	/** Storing an empty scope forgets the previous connection's permissions. */
	public function test_store_without_scope_clears_previous_scopes() {
		GrantedScopes::store( 'settlements.read' );
		GrantedScopes::store( '' );

		$this->assertNull( GrantedScopes::get() );
		$this->assertArrayNotHasKey( GrantedScopes::OPTION, $GLOBALS['_fair_test_options'] );
	}

	/** Nothing asks for settlement access unless a plugin opts in. */
	public function test_settlement_access_is_not_requested_by_default() {
		$this->assertFalse( GrantedScopes::is_settlement_access_requested() );
	}
}
