<?php
/**
 * Experimental fallback API token adapters
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Tests\API;

use FairEventsShared\API\AbstractApiTokensController;
use FairEventsShared\API\AbstractExternalMeController;
use FairEventsShared\API\AbstractExternalTransactionsController;
use FairEventsShared\ApiTokens\AbstractApiToken;
use FairEventsShared\ApiTokens\AbstractApiTokenAuth;
use FairPaymentsConnectorExperimental\API\ApiTokenAuth;
use FairPaymentsConnectorExperimental\API\ApiTokensController;
use FairPaymentsConnectorExperimental\API\ExternalMeController;
use FairPaymentsConnectorExperimental\API\ExternalTransactionsController;
use FairPaymentsConnectorExperimental\Models\ApiToken;
use PHPUnit\Framework\TestCase;

$fair_test_connector_tests = dirname( __DIR__, 3 ) . '/fair-payments-connector/__tests__';
require_once $fair_test_connector_tests . '/ApiTokens/fixtures-api-token-doubles.php';
require_once __DIR__ . '/fixtures-connector-schema.php';

/**
 * The fallback serves the same shared implementation as Fair Payments
 * Connector: the same table, routes and responses, with this plugin's own
 * class names and text domain.
 */
class ApiTokenAdaptersTest extends TestCase {

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
	private $db;

	/**
	 * Install the in-memory database and reset the stub globals.
	 */
	protected function setUp(): void {
		parent::setUp();
		$this->previous_wpdb = $GLOBALS['wpdb'] ?? null;
		$this->db            = new \Fair_Test_Api_Token_WPDB();
		$GLOBALS['wpdb']     = $this->db; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.

		$GLOBALS['_fair_test_gettext_domains'] = array();
		$GLOBALS['_fair_test_password_chars']  = array();
		$GLOBALS['_fair_test_rest_routes']     = array();
	}

	/**
	 * Restore the previous `$wpdb`.
	 */
	protected function tearDown(): void {
		$GLOBALS['wpdb'] = $this->previous_wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- unit test installs a $wpdb double.
		unset( $GLOBALS['_fair_test_gettext_domains'], $GLOBALS['_fair_test_password_chars'], $GLOBALS['_fair_test_rest_routes'] );
		parent::tearDown();
	}

	/**
	 * Every class keeps its name and extends the shared implementation.
	 */
	public function test_adapters_extend_the_shared_implementation() {
		$this->assertTrue( is_subclass_of( ApiToken::class, AbstractApiToken::class ) );
		$this->assertTrue( is_subclass_of( ApiTokenAuth::class, AbstractApiTokenAuth::class ) );
		$this->assertTrue( is_subclass_of( ApiTokensController::class, AbstractApiTokensController::class ) );
		$this->assertTrue( is_subclass_of( ExternalMeController::class, AbstractExternalMeController::class ) );
		$this->assertTrue( is_subclass_of( ExternalTransactionsController::class, AbstractExternalTransactionsController::class ) );
		$this->assertSame( array( 'transactions:read' ), ApiToken::ALLOWED_SCOPES );
	}

	/**
	 * Tokens live in Fair Payments Connector's table, as hashes.
	 */
	public function test_tokens_use_the_connector_table() {
		$created = ApiToken::create( 'partner.example', array( 'transactions:read' ) );

		$this->assertSame( array( 'wp_fair_payment_api_tokens' ), array_keys( $this->db->tables ) );
		$this->assertSame(
			hash( 'sha256', $created['token'] ),
			$this->db->tables['wp_fair_payment_api_tokens'][ $created['id'] ]['token_hash']
		);
		$this->assertSame( (string) $created['id'], ApiToken::find_by_token( $created['token'] )->id );
	}

	/**
	 * Authentication failures use this plugin's text domain.
	 */
	public function test_auth_messages_use_the_experimental_domain() {
		$missing = ApiTokenAuth::authenticate( new \Fair_Test_Api_Token_Request() );
		$this->assertSame( 'rest_forbidden', $missing->get_error_code() );
		$this->assertSame( 401, $missing->get_error_data()['status'] );

		$created = ApiToken::create( 'partner.example', array( 'transactions:read' ) );
		$request = new \Fair_Test_Api_Token_Request( array(), array( 'Authorization' => 'Bearer ' . $created['token'] ) );
		$this->assertTrue( ApiTokenAuth::authenticate( $request, 'transactions:read' ) );

		$scope = ApiTokenAuth::authenticate( $request, 'locations:read' );
		$this->assertSame( 'rest_insufficient_scope', $scope->get_error_code() );

		$this->assertSame(
			array( 'fair-payments-connector-experimental', 'fair-payments-connector-experimental' ),
			$GLOBALS['_fair_test_gettext_domains']
		);
	}

	/**
	 * Controllers register the same routes, with this plugin's text domain.
	 */
	public function test_controllers_register_the_same_routes() {
		( new ApiTokensController() )->register_routes();
		( new ExternalMeController() )->register_routes();
		( new ExternalTransactionsController() )->register_routes();

		$this->assertSame(
			array(
				'/fair-payments-connector/v1/admin/api-tokens',
				'/fair-payments-connector/v1/admin/api-tokens/(?P<id>\d+)',
				'/fair-payments-connector/v1/external/me',
				'/fair-payments-connector/v1/external/transactions',
			),
			array_keys( $GLOBALS['_fair_test_rest_routes'] )
		);
		$this->assertSame( array( 'fair-payments-connector-experimental' ), array_unique( $GLOBALS['_fair_test_gettext_domains'] ) );

		$label = ( new ApiTokensController() )->create_item( new \Fair_Test_Api_Token_Request( array( 'scopes' => array( 'transactions:read' ) ) ) );
		$this->assertSame( 'rest_invalid_label', $label->get_error_code() );
		$this->assertSame( 'fair-payments-connector-experimental', end( $GLOBALS['_fair_test_gettext_domains'] ) );
	}
}
