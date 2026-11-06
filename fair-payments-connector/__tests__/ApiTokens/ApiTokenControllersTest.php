<?php
/**
 * Shared token REST controllers, through Fair Payments Connector's adapters
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\ApiTokens;

use FairEventsShared\API\AbstractApiTokensController;
use FairEventsShared\API\AbstractExternalMeController;
use FairEventsShared\API\AbstractExternalTransactionsController;
use FairPaymentsConnector\API\ApiTokensController;
use FairPaymentsConnector\API\ExternalMeController;
use FairPaymentsConnector\API\ExternalTransactionsController;
use FairPaymentsConnector\Models\ApiToken;

require_once __DIR__ . '/ApiTokenTestCase.php';

/**
 * Token administration, introspection and the transactions endpoint keep
 * their routes, responses and messages.
 */
class ApiTokenControllersTest extends ApiTokenTestCase {

	const TOKEN_FIELDS = array( 'id', 'label', 'scopes', 'created_at', 'last_used_at', 'status' );

	/**
	 * Each controller is a thin adapter keeping its class name.
	 */
	public function test_controllers_extend_the_shared_implementation() {
		$this->assertTrue( is_subclass_of( ApiTokensController::class, AbstractApiTokensController::class ) );
		$this->assertTrue( is_subclass_of( ExternalMeController::class, AbstractExternalMeController::class ) );
		$this->assertTrue( is_subclass_of( ExternalTransactionsController::class, AbstractExternalTransactionsController::class ) );
		$this->assertSame( 200, ExternalTransactionsController::MAX_PER_PAGE );
	}

	/**
	 * Routes keep their paths, methods, permissions and scope enum.
	 */
	public function test_routes_are_registered_under_the_plugin_namespace() {
		$tokens = new ApiTokensController();
		$tokens->register_routes();
		( new ExternalMeController() )->register_routes();
		( new ExternalTransactionsController() )->register_routes();

		$routes = $GLOBALS['_fair_test_rest_routes'];
		$this->assertSame(
			array(
				'/fair-payments-connector/v1/admin/api-tokens',
				'/fair-payments-connector/v1/admin/api-tokens/(?P<id>\d+)',
				'/fair-payments-connector/v1/external/me',
				'/fair-payments-connector/v1/external/transactions',
			),
			array_keys( $routes )
		);

		$collection = $routes['/fair-payments-connector/v1/admin/api-tokens'];
		$this->assertSame( array( 'GET', 'POST' ), array_column( $collection, 'methods' ) );
		$this->assertSame( array( $tokens, 'permissions_check' ), $collection[0]['permission_callback'] );
		$this->assertSame( array( 'transactions:read' ), $collection[1]['args']['scopes']['items']['enum'] );
		$this->assertSame( array( $tokens, 'delete_item' ), $routes['/fair-payments-connector/v1/admin/api-tokens/(?P<id>\d+)'][0]['callback'] );

		$this->assertIsCallable( $routes['/fair-payments-connector/v1/external/me'][0]['permission_callback'] );

		$args = $routes['/fair-payments-connector/v1/external/transactions'][0]['args'];
		$this->assertSame( array( 'page', 'per_page', 'status', 'from', 'to' ), array_keys( $args ) );
		$this->assertSame( 200, $args['per_page']['maximum'] );
		$this->assertSame( 'Filter by transaction date (created_at) from this date, e.g. 2026-01-01.', $args['from']['description'] );
		$this->assertSame( array( 'fair-payments-connector' ), array_unique( $GLOBALS['_fair_test_gettext_domains'] ) );
	}

	/**
	 * Only administrators manage tokens.
	 */
	public function test_permissions_require_an_administrator() {
		$controller = new ApiTokensController();
		$this->assertFalse( $controller->permissions_check() );

		$GLOBALS['_fair_test_current_user_can'] = true;
		$this->assertTrue( $controller->permissions_check() );
	}

	/**
	 * Creation returns the plaintext once; listing never does.
	 */
	public function test_create_discloses_the_plaintext_only_once() {
		$GLOBALS['_fair_test_password_chars'] = array( 'Q' );
		$controller                           = new ApiTokensController();

		$created = $controller->create_item(
			$this->request(
				null,
				array(
					'label'  => 'partner.example',
					'scopes' => array( 'transactions:read', 'transactions:read' ),
				)
			)
		);

		$this->assertSame( 201, $created->status );
		$this->assertSame( array_merge( self::TOKEN_FIELDS, array( 'token' ) ), array_keys( $created->data ) );
		$this->assertSame( str_repeat( 'Q', 40 ), $created->data['token'] );
		$this->assertSame( array( 'transactions:read' ), $created->data['scopes'] );
		$this->assertSame( 'active', $created->data['status'] );

		$listed = $controller->get_items( $this->request() );
		$this->assertSame( 200, $listed->status );
		$this->assertSame( self::TOKEN_FIELDS, array_keys( $listed->data[0] ) );
		$this->assertStringNotContainsString( $created->data['token'], (string) json_encode( $listed->data ) ); // phpcs:ignore WordPress.WP.AlternativeFunctions.json_encode_json_encode -- no WordPress in unit tests.
	}

	/**
	 * Invalid requests and failures keep their codes, statuses and messages.
	 */
	public function test_create_rejections_keep_their_contract() {
		$controller = new ApiTokensController();
		$create     = function ( array $params ) use ( $controller ) {
			return $controller->create_item( $this->request( null, $params ) );
		};

		$label = $create( array( 'scopes' => array( 'transactions:read' ) ) );
		$this->assertSame( array( 'rest_invalid_label', 'A label is required.', 400 ), $this->error( $label ) );

		foreach ( array( array(), array( 'locations:read' ), array( 'transactions:read', 'everything' ) ) as $scopes ) {
			$rejected = $create(
				array(
					'label'  => 'x',
					'scopes' => $scopes,
				)
			);
			$this->assertSame( array( 'rest_invalid_scopes', 'At least one valid scope is required.', 400 ), $this->error( $rejected ) );
		}
		$this->assertArrayNotHasKey( 'wp_fair_payment_api_tokens', $this->db->tables, 'Nothing is stored for a rejected request.' );

		$this->db->fail_insert = true;
		$failed                = $create(
			array(
				'label'  => 'x',
				'scopes' => array( 'transactions:read' ),
			)
		);
		$this->assertSame( array( 'rest_api_token_creation_failed', 'Failed to create API token.', 500 ), $this->error( $failed ) );
		$this->assertSame( array( 'fair-payments-connector' ), array_unique( $GLOBALS['_fair_test_gettext_domains'] ) );
	}

	/**
	 * Revoking returns the revoked token; an unknown ID is a 404.
	 */
	public function test_delete_revokes_or_reports_unknown() {
		$controller = new ApiTokensController();
		$id         = $this->seed( 'to-revoke', array( 'transactions:read' ) );

		$revoked = $controller->delete_item( $this->request( null, array( 'id' => $id ) ) );
		$this->assertSame( 200, $revoked->status );
		$this->assertSame( self::TOKEN_FIELDS, array_keys( $revoked->data ) );
		$this->assertSame( 'revoked', $revoked->data['status'] );

		$unknown = $controller->delete_item( $this->request( null, array( 'id' => 999 ) ) );
		$this->assertSame( array( 'rest_api_token_not_found', 'API token not found.', 404 ), $this->error( $unknown ) );
	}

	/**
	 * Introspection returns the authenticated token without secrets.
	 */
	public function test_me_returns_the_authenticated_token() {
		$id      = $this->seed( 'me-token', array( 'transactions:read', 'locations:read' ) );
		$request = $this->request( null, array( '_fair_api_token' => ApiToken::get_by_id( $id ) ) );

		$response = ( new ExternalMeController() )->get_item( $request );

		$this->assertSame( 200, $response->status );
		$this->assertSame( self::TOKEN_FIELDS, array_keys( $response->data ) );
		$this->assertSame( array( 'transactions:read', 'locations:read' ), $response->data['scopes'] );
	}

	/**
	 * The transactions endpoint clamps paging, passes filters through and
	 * keeps its response shape.
	 */
	public function test_transactions_paging_filters_and_shape() {
		$controller = new Fair_Test_External_Transactions_Controller();
		$response   = $controller->get_items(
			$this->request(
				null,
				array(
					'page'     => 3,
					'per_page' => 500,
					'status'   => 'paid',
					'from'     => '2026-01-01',
					'to'       => '2026-12-31',
				)
			)
		);

		$this->assertSame(
			array(
				'limit'     => 200,
				'offset'    => 400,
				'status'    => 'paid',
				'date_from' => '2026-01-01',
				'date_to'   => '2026-12-31',
				'orderby'   => 'created_at',
				'order'     => 'DESC',
			),
			$controller->queried
		);
		$this->assertSame(
			array(
				'status'    => 'paid',
				'date_from' => '2026-01-01',
				'date_to'   => '2026-12-31',
			),
			$controller->counted
		);
		$this->assertSame( array( 'transactions', 'total', 'page', 'per_page' ), array_keys( $response->data ) );
		$this->assertSame( 7, $response->data['total'] );
		$this->assertSame( 3, $response->data['page'] );
		$this->assertSame( 200, $response->data['per_page'] );
		$this->assertSame(
			array(
				'id'                => 5,
				'mollie_payment_id' => 'tr_x',
				'amount'            => 12.5,
				'currency'          => 'EUR',
				'mollie_fee'        => 0.29,
				'application_fee'   => null,
				'status'            => 'paid',
				'testmode'          => true,
				'description'       => 'Ticket',
				'event_date_id'     => 9,
				'event_url'         => '',
				'created_at'        => '2026-02-01 10:00:00',
			),
			$response->data['transactions'][0]
		);

		$defaults = $controller->get_items( $this->request( null, array( 'per_page' => 0 ) ) );
		$this->assertSame( 50, $defaults->data['per_page'] );
		$this->assertSame( 1, $defaults->data['page'] );
	}

	/**
	 * Date filters accept empty or parseable values only.
	 */
	public function test_validate_date() {
		$controller = new ExternalTransactionsController();

		$this->assertTrue( $controller->validate_date( '' ) );
		$this->assertTrue( $controller->validate_date( '2026-01-01' ) );
		$this->assertFalse( $controller->validate_date( 'not-a-date' ) );
	}

	/**
	 * Code, message and status of an error.
	 *
	 * @param mixed $error Expected WP_Error.
	 * @return array
	 */
	private function error( $error ) {
		$this->assertInstanceOf( \WP_Error::class, $error );
		return array( $error->get_error_code(), $error->get_error_message(), $error->get_error_data()['status'] );
	}
}

// phpcs:disable Generic.Files.OneObjectStructurePerFile.MultipleFound

/**
 * The plugin's transactions controller over canned rows instead of the database.
 */
class Fair_Test_External_Transactions_Controller extends ExternalTransactionsController {

	/**
	 * Arguments passed to get_transactions().
	 *
	 * @var array|null
	 */
	public $queried;

	/**
	 * Arguments passed to count_transactions().
	 *
	 * @var array|null
	 */
	public $counted;

	/**
	 * Canned page of rows.
	 *
	 * @param array $args Query arguments.
	 * @return object[]
	 */
	protected function get_transactions( array $args ) {
		$this->queried = $args;

		return array(
			(object) array(
				'id'                => '5',
				'mollie_payment_id' => 'tr_x',
				'amount'            => '12.50',
				'currency'          => 'EUR',
				'mollie_fee'        => '0.29',
				'application_fee'   => null,
				'status'            => 'paid',
				'testmode'          => '1',
				'description'       => 'Ticket',
				'event_date_id'     => '9',
				'created_at'        => '2026-02-01 10:00:00',
			),
		);
	}

	/**
	 * Canned count.
	 *
	 * @param array $args Filters.
	 * @return int
	 */
	protected function count_transactions( array $args ) {
		$this->counted = $args;
		return 7;
	}
}
