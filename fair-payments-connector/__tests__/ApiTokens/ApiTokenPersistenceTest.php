<?php
/**
 * Shared API token persistence, through Fair Payments Connector's model
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\ApiTokens;

use FairEventsShared\ApiTokens\AbstractApiToken;
use FairPaymentsConnector\Models\ApiToken;

require_once __DIR__ . '/ApiTokenTestCase.php';

/**
 * Tokens are stored as hashes in the plugin's table, found only while
 * active, and their plaintext is disclosed only by create().
 */
class ApiTokenPersistenceTest extends ApiTokenTestCase {

	/**
	 * The model is a thin adapter over the shared implementation.
	 */
	public function test_model_extends_the_shared_implementation() {
		$this->assertTrue( is_subclass_of( ApiToken::class, AbstractApiToken::class ) );
		$this->assertSame( array(), AbstractApiToken::ALLOWED_SCOPES, 'The shared default grants nothing.' );
	}

	/**
	 * Create returns the plaintext once and stores only its SHA-256 hash.
	 */
	public function test_create_stores_only_the_hash_and_returns_the_plaintext() {
		$GLOBALS['_fair_test_password_chars'] = array( 'K' );

		$result = ApiToken::create( 'partner.example', array( 'transactions:read' ) );

		$this->assertSame( array( 'id', 'token' ), array_keys( $result ) );
		$this->assertSame( str_repeat( 'K', 40 ), $result['token'] );

		$row = $this->db->tables['wp_fair_payment_api_tokens'][ $result['id'] ];
		$this->assertSame( hash( 'sha256', $result['token'] ), $row['token_hash'] );
		$this->assertSame( '["transactions:read"]', $row['scopes'] );
		$this->assertNotContains( $result['token'], $row );
		$this->assertSame( array( 'wp_fair_payment_api_tokens' ), $this->db->touched );
	}

	/**
	 * Scopes outside ALLOWED_SCOPES are never stored.
	 */
	public function test_create_drops_unsupported_scopes() {
		$result = ApiToken::create( 'partner.example', array( 'locations:read', 'transactions:read', 'everything' ) );

		$this->assertSame(
			'["transactions:read"]',
			$this->db->tables['wp_fair_payment_api_tokens'][ $result['id'] ]['scopes']
		);
	}

	/**
	 * A failed insert reports failure and discloses nothing.
	 */
	public function test_create_reports_a_failed_insert() {
		$this->db->fail_insert = true;

		$this->assertFalse( ApiToken::create( 'partner.example', array( 'transactions:read' ) ) );
	}

	/**
	 * Tokens are found by plaintext only while active.
	 */
	public function test_find_by_token_matches_only_active_tokens() {
		$active  = $this->seed( 'active-token', array( 'transactions:read' ) );
		$revoked = $this->seed( 'revoked-token', array( 'transactions:read' ) );
		ApiToken::revoke( $revoked );

		$this->assertSame( (string) $active, ApiToken::find_by_token( 'active-token' )->id );
		$this->assertNull( ApiToken::find_by_token( 'revoked-token' ) );
		$this->assertNull( ApiToken::find_by_token( 'unknown-token' ) );
		$this->assertNull( ApiToken::find_by_token( hash( 'sha256', 'active-token' ) ), 'The stored hash is not a token.' );
	}

	/**
	 * Revoking keeps the row, marks it revoked, and reports unknown IDs.
	 */
	public function test_revoke_marks_the_row_revoked() {
		$id = $this->seed( 'to-revoke', array( 'transactions:read' ) );

		$this->assertTrue( ApiToken::revoke( $id ) );
		$this->assertFalse( ApiToken::revoke( 99 ) );

		$row = ApiToken::get_by_id( $id );
		$this->assertNotNull( $row->revoked_at );
		$this->assertFalse( ApiToken::is_active( $row ) );
		$this->assertSame( 'revoked', ApiToken::to_array( $row )['status'] );
	}

	/**
	 * Use is recorded on the row.
	 */
	public function test_touch_last_used_records_use() {
		$id = $this->seed( 'used', array( 'transactions:read' ) );

		ApiToken::touch_last_used( $id );

		$this->assertNotNull( ApiToken::get_by_id( $id )->last_used_at );
	}

	/**
	 * All tokens are listed newest first.
	 */
	public function test_get_all_lists_newest_first() {
		$older = $this->seed( 'older', array( 'transactions:read' ), '2026-01-01 10:00:00' );
		$newer = $this->seed( 'newer', array( 'locations:read' ), '2026-03-01 10:00:00' );

		$this->assertSame(
			array( (string) $newer, (string) $older ),
			array_column( ApiToken::get_all(), 'id' )
		);
	}

	/**
	 * Generated tokens are 40 characters and hashes are SHA-256 hex.
	 */
	public function test_token_and_hash_formats() {
		$this->assertSame( 40, strlen( ApiToken::generate_token() ) );
		$this->assertMatchesRegularExpression( '/^[a-f0-9]{64}$/', ApiToken::hash_token( 'x' ) );
	}
}
