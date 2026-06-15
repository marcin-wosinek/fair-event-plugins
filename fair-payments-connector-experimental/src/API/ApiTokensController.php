<?php
/**
 * Admin REST API controller for API tokens.
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\API;

defined( 'WPINC' ) || die;

use FairPaymentsConnectorExperimental\Models\ApiToken;
use WP_REST_Controller;
use WP_REST_Server;
use WP_REST_Request;
use WP_REST_Response;
use WP_Error;

/**
 * Handles admin endpoints for listing, creating and revoking API tokens.
 */
class ApiTokensController extends WP_REST_Controller {

	/**
	 * Namespace for the REST API.
	 *
	 * @var string
	 */
	protected $namespace = 'fair-payments-connector/v1';

	/**
	 * Register the admin API token routes.
	 *
	 * @return void
	 */
	public function register_routes() {
		register_rest_route(
			$this->namespace,
			'/admin/api-tokens',
			array(
				array(
					'methods'             => WP_REST_Server::READABLE,
					'callback'            => array( $this, 'get_items' ),
					'permission_callback' => array( $this, 'permissions_check' ),
				),
				array(
					'methods'             => WP_REST_Server::CREATABLE,
					'callback'            => array( $this, 'create_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'label'  => array(
							'type'              => 'string',
							'required'          => true,
							'sanitize_callback' => 'sanitize_text_field',
						),
						'scopes' => array(
							'type'     => 'array',
							'required' => true,
							'items'    => array(
								'type' => 'string',
								'enum' => ApiToken::ALLOWED_SCOPES,
							),
						),
					),
				),
			)
		);

		register_rest_route(
			$this->namespace,
			'/admin/api-tokens/(?P<id>\d+)',
			array(
				array(
					'methods'             => WP_REST_Server::DELETABLE,
					'callback'            => array( $this, 'delete_item' ),
					'permission_callback' => array( $this, 'permissions_check' ),
					'args'                => array(
						'id' => array(
							'type'              => 'integer',
							'sanitize_callback' => 'absint',
						),
					),
				),
			)
		);
	}

	/**
	 * Admin capability check for all routes.
	 *
	 * @return bool
	 */
	public function permissions_check() {
		return current_user_can( 'manage_options' );
	}

	/**
	 * List all API tokens.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response
	 */
	public function get_items( $request ) {
		$tokens = ApiToken::get_all();

		$data = array_map(
			array( ApiToken::class, 'to_array' ),
			$tokens
		);

		return new WP_REST_Response( $data, 200 );
	}

	/**
	 * Create a new API token.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function create_item( $request ) {
		$label  = $request->get_param( 'label' );
		$scopes = (array) $request->get_param( 'scopes' );

		if ( empty( $label ) ) {
			return new WP_Error(
				'rest_invalid_label',
				__( 'A label is required.', 'fair-payments-connector-experimental' ),
				array( 'status' => 400 )
			);
		}

		$valid_scopes = array_values( array_intersect( $scopes, ApiToken::ALLOWED_SCOPES ) );

		if ( empty( $valid_scopes ) ) {
			return new WP_Error(
				'rest_invalid_scopes',
				__( 'At least one valid scope is required.', 'fair-payments-connector-experimental' ),
				array( 'status' => 400 )
			);
		}

		$result = ApiToken::create( $label, $valid_scopes );

		if ( ! $result ) {
			return new WP_Error(
				'rest_api_token_creation_failed',
				__( 'Failed to create API token.', 'fair-payments-connector-experimental' ),
				array( 'status' => 500 )
			);
		}

		$row      = ApiToken::get_by_id( $result['id'] );
		$response = ApiToken::to_array( $row );

		// One-time plaintext token; never retrievable again.
		$response['token'] = $result['token'];

		return new WP_REST_Response( $response, 201 );
	}

	/**
	 * Revoke an API token.
	 *
	 * @param WP_REST_Request $request Full data about the request.
	 * @return WP_REST_Response|WP_Error
	 */
	public function delete_item( $request ) {
		$id = (int) $request->get_param( 'id' );

		$existing = ApiToken::get_by_id( $id );
		if ( ! $existing ) {
			return new WP_Error(
				'rest_api_token_not_found',
				__( 'API token not found.', 'fair-payments-connector-experimental' ),
				array( 'status' => 404 )
			);
		}

		ApiToken::revoke( $id );

		$row = ApiToken::get_by_id( $id );

		return new WP_REST_Response( ApiToken::to_array( $row ), 200 );
	}
}
