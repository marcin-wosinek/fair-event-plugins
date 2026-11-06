<?php
/**
 * Base test case for the API token tests
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\ApiTokens;

use PHPUnit\Framework\TestCase;

require_once __DIR__ . '/fixtures-api-token-doubles.php';

/**
 * Gives each test an empty in-memory token table and clean stub globals.
 */
abstract class ApiTokenTestCase extends TestCase {

	/**
	 * The `$wpdb` in place before the test.
	 *
	 * @var mixed
	 */
	private $previous_wpdb;

	/**
	 * In-memory database for this test.
	 *
	 * @var \Fair_Test_Api_Token_WPDB
	 */
	protected $db;

	/**
	 * Install the in-memory database and reset the stub globals.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->previous_wpdb = $GLOBALS['wpdb'] ?? null;
		$this->db            = new \Fair_Test_Api_Token_WPDB();
		$GLOBALS['wpdb']     = $this->db; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.

		$GLOBALS['_fair_test_gettext_domains']  = array();
		$GLOBALS['_fair_test_password_chars']   = array();
		$GLOBALS['_fair_test_rest_routes']      = array();
		$GLOBALS['_fair_test_current_user_can'] = false;
	}

	/**
	 * Restore the previous `$wpdb`.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->previous_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.
		unset(
			$GLOBALS['_fair_test_gettext_domains'],
			$GLOBALS['_fair_test_password_chars'],
			$GLOBALS['_fair_test_rest_routes'],
			$GLOBALS['_fair_test_current_user_can']
		);
		parent::tearDown();
	}

	/**
	 * Seed a token row as an older release stored it.
	 *
	 * @param string   $plaintext  Plaintext token.
	 * @param string[] $scopes     Stored scopes.
	 * @param string   $created_at Creation time.
	 * @return int Row ID.
	 */
	protected function seed( $plaintext, array $scopes, $created_at = '2026-01-01 10:00:00' ) {
		$this->db->insert(
			'wp_fair_payment_api_tokens',
			array(
				'label'      => 'seeded.example',
				'token_hash' => hash( 'sha256', $plaintext ),
				'scopes'     => (string) json_encode( $scopes ), // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- no WordPress in unit tests.
				'created_at' => $created_at,
			)
		);

		return $this->db->insert_id;
	}

	/**
	 * A request carrying the given Authorization header.
	 *
	 * @param string|null $authorization Header value, or null for none.
	 * @param array       $params        Request params.
	 * @return \Fair_Test_Api_Token_Request
	 */
	protected function request( $authorization = null, array $params = array() ) {
		return new \Fair_Test_Api_Token_Request(
			$params,
			null === $authorization ? array() : array( 'Authorization' => $authorization )
		);
	}
}
