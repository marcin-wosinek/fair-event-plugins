<?php
/**
 * ApiToken scope tests
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\Models;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnectorExperimental\Models\ApiToken;

/**
 * `locations:read` is retired: tokens that still store it keep working for
 * transactions, keep listing it, and gain nothing from it.
 */
class ApiTokenScopeTest extends TestCase {

	/**
	 * Build a token row as stored.
	 *
	 * @param string[] $scopes     Stored scopes.
	 * @param mixed    $revoked_at Revocation time, or null.
	 * @return object
	 */
	private function row( array $scopes, $revoked_at = null ) {
		return (object) array(
			'id'           => 7,
			'label'        => 'legacy.example',
			'token_hash'   => str_repeat( 'a', 64 ),
			'scopes'       => (string) json_encode( $scopes ), // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- no WordPress in unit tests.
			'created_at'   => '2026-01-01 10:00:00',
			'last_used_at' => null,
			'revoked_at'   => $revoked_at,
		);
	}

	/**
	 * Only `transactions:read` can be granted to a new token.
	 */
	public function test_only_transactions_read_can_be_granted() {
		$this->assertSame( array( 'transactions:read' ), ApiToken::ALLOWED_SCOPES );
	}

	/**
	 * A token carrying both scopes keeps its transaction access.
	 */
	public function test_mixed_legacy_token_keeps_transaction_access() {
		$row = $this->row( array( 'transactions:read', 'locations:read' ) );

		$this->assertTrue( ApiToken::has_scope( $row, 'transactions:read' ) );
	}

	/**
	 * The retired scope authorizes nothing, even when stored.
	 */
	public function test_stored_locations_scope_grants_nothing() {
		$mixed          = $this->row( array( 'transactions:read', 'locations:read' ) );
		$locations_only = $this->row( array( 'locations:read' ) );

		$this->assertFalse( ApiToken::has_scope( $mixed, 'locations:read' ) );
		$this->assertFalse( ApiToken::has_scope( $locations_only, 'locations:read' ) );
		$this->assertFalse( ApiToken::has_scope( $locations_only, 'transactions:read' ) );
	}

	/**
	 * Responses keep the stored scopes and never expose the hash.
	 */
	public function test_response_keeps_legacy_scopes_and_hides_the_hash() {
		$data = ApiToken::to_array( $this->row( array( 'transactions:read', 'locations:read' ) ) );

		$this->assertSame(
			array( 'id', 'label', 'scopes', 'created_at', 'last_used_at', 'status' ),
			array_keys( $data )
		);
		$this->assertSame( array( 'transactions:read', 'locations:read' ), $data['scopes'] );
		$this->assertSame( 'active', $data['status'] );
	}

	/**
	 * A revoked token reports as revoked.
	 */
	public function test_revoked_token_reports_revoked() {
		$data = ApiToken::to_array( $this->row( array( 'transactions:read' ), '2026-02-01 10:00:00' ) );

		$this->assertSame( 'revoked', $data['status'] );
	}

	/**
	 * A token with no or unreadable scopes grants nothing.
	 */
	public function test_missing_scopes_grant_nothing() {
		$row         = $this->row( array() );
		$row->scopes = 'not json';

		$this->assertSame( array(), ApiToken::get_scopes( $row ) );
		$this->assertFalse( ApiToken::has_scope( $row, 'transactions:read' ) );
	}
}
